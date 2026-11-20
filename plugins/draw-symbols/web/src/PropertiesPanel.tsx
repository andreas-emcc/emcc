import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { RotateCw } from 'lucide-react';
import { Button, choosableDataTypes, Notice, Select, TextField as SdkTextField } from '@emc2/plugin-sdk';
import type { CoordinateService, DataType, Layer, MapObject, SymbolService } from '@emc2/plugin-sdk';
import { categoriesOf, NO_ECHELON, usesEchelon } from './categories.ts';
import { altitudeOf, EDITABLE_MODIFIERS, isEditableSymbol, MAX_NAME_LENGTH, MAX_TEXT_LENGTH, pointOf, validPosition, withDataType, withLayer, withAltitude, withDirection, withModifier, withName, withPosition, withSidc, withSpeed } from './content.ts';
import type { EditableModifier, EditableSymbol } from './content.ts';
import { NOT_READ_HINT } from './controller.ts';
import type { DrawController } from './controller.ts';
import { FieldsEditor } from './FieldsEditor.tsx';
import { keepAltitudeUnit, keepSpeedUnit, readKeptAltitudeUnit, readKeptSpeedUnit } from './keptChoice.ts';
import { partsOf, vesselIdentityOf, vesselOf, withParts, withVessel } from './symbolParts.ts';
import { SymbolPicture } from './SymbolPicture.tsx';
import { ALTITUDE_SHORT, ALTITUDE_UNITS, DEFAULT_ALTITUDE_UNIT, DEFAULT_SPEED_UNIT, isAltitudeUnit, isSpeedUnit, lengthIn, lengthToMetres, parseNumber, SPEED_SHORT, SPEED_UNITS, speedIn, speedToMps } from './units.ts';
import type { AltitudeUnit, SpeedUnit } from './units.ts';
import { useDrawState } from './useDrawState.ts';

/** A typed number is at most this long (a sign, digits and a point). */
const MAX_NUMBER_LENGTH = 20;

/** What a field's commit answers: true (done), false (the server refused; the user was told) or a problem with the input to show. */
type CommitResult = boolean | string;

const MODIFIER_LABELS: Readonly<Record<EditableModifier, string>> = {
  uniqueDesignation: 'Unique designation',
  higherFormation: 'Higher formation',
  additionalInformation: 'Additional information',
};

/** Panel "Symbol properties" (brief, functions 4, 5, 12 and 14): the one selected symbol, with the map view's selection. */
export function PropertiesPanel(props: { readonly controller: DrawController; readonly symbols: SymbolService; readonly coordinates: CoordinateService }) {
  const { controller, symbols, coordinates } = props;
  const state = useDrawState(controller);
  const { selected } = state;
  if (state.selectionCount === 0) return <p className="draw-symbols-hint">Select a symbol on the map.</p>;
  if (state.selectionCount > 1) return <Notice>{state.selectionCount} objects selected</Notice>;
  if (selected === null) {
    if (state.readStatus === 'failed') {
      return (
        <div className="draw-symbols-panel">
          <Notice severity="warning">{NOT_READ_HINT}</Notice>
          <div className="draw-symbols-place">
            <Button icon={RotateCw} onClick={() => { controller.retryRead(); }}>Try again</Button>
          </div>
        </div>
      );
    }
    return <Notice>{state.readStatus === 'missing' ? 'The selected object no longer exists.' : 'The selected object has not arrived yet.'}</Notice>;
  }
  if (selected.type !== 'core.symbol') return null; // another kind of object, e.g. a shape: its own plugin shows it
  if (!isEditableSymbol(selected)) {
    return (
      <div className="draw-symbols-panel">
        <p className="draw-symbols-hint">This object ({selected.type}) is not a point symbol. It cannot be edited here.</p>
        <Facts object={selected} layers={state.layers} dataTypes={state.dataTypes} showDataType />
      </div>
    );
  }
  return (
    // The key resets what the user has typed when another symbol is selected.
    <SymbolForm
      key={selected.id}
      object={selected}
      layers={state.layers}
      inView={state.inView}
      readOnly={state.readOnly}
      readOnlyHint={state.readOnlyHint}
      dataTypes={state.dataTypes}
      controller={controller}
      symbols={symbols}
      coordinates={coordinates}
    />
  );
}

function SymbolForm(props: {
  readonly object: EditableSymbol;
  readonly layers: readonly Layer[];
  /** False: the symbol is outside the area this plugin follows; it was read from the server and is read again before every change. */
  readonly inView: boolean;
  /** The user lacks the workspace's edit permission (brief, functions 11 and 18), or the symbol is not in the workspace (function 17): everything is shown, nothing can be changed. */
  readonly readOnly: boolean;
  /** Why: shown above the fields. */
  readonly readOnlyHint: string;
  readonly dataTypes: readonly DataType[];
  readonly controller: DrawController;
  readonly symbols: SymbolService;
  readonly coordinates: CoordinateService;
}) {
  const { object, layers, inView, readOnly, readOnlyHint, dataTypes, controller, symbols, coordinates } = props;
  const catalog = useMemo(() => symbols.catalog(), [symbols]);
  const parts = useMemo(() => partsOf(symbols, object.symbol), [symbols, object.symbol]);
  const vessel = useMemo(() => vesselOf(object.symbol), [object.symbol]);
  const vesselGroups = useMemo(() => symbols.vesselGroups(), [symbols]);
  const format = useSyncExternalStore(
    useCallback((onChange: () => void) => coordinates.chosenFormat.onChange(onChange), [coordinates]),
    () => coordinates.chosenFormat.value,
  );
  const position = pointOf(object.geometry);
  const declaredFields = controller.declaredFields;
  // The units of the speed and altitude fields: kept in this browser, km/h and metres until the user chooses.
  const [speedUnit, setSpeedUnit] = useState<SpeedUnit>(() => {
    const kept = readKeptSpeedUnit();
    return isSpeedUnit(kept) ? kept : DEFAULT_SPEED_UNIT;
  });
  const [altitudeUnit, setAltitudeUnit] = useState<AltitudeUnit>(() => {
    const kept = readKeptAltitudeUnit();
    return isAltitudeUnit(kept) ? kept : DEFAULT_ALTITUDE_UNIT;
  });

  const edit = (what: string, change: Parameters<DrawController['update']>[2]) => controller.update(object.id, what, change);
  const editParts = (change: Parameters<typeof withParts>[2]) => {
    controller.guard(
      edit('change the symbol', (core) => {
        if (core.symbol === undefined) return core;
        const sidc = withParts(symbols, core.symbol, change);
        return sidc === null ? core : withSidc(core, sidc);
      }),
    );
  };

  const editVessel = (change: Parameters<typeof withVessel>[1]) => {
    controller.guard(
      edit('change the vessel', (core) => {
        if (core.symbol === undefined) return core;
        const sidc = withVessel(core.symbol, change);
        return sidc === null ? core : withSidc(core, sidc);
      }),
    );
  };

  const identities = withCurrent(catalog.standardIdentities.map((i) => ({ value: i.code, label: i.name })), parts?.standardIdentity);
  // A vessel has the identities 0 to 6 (APP-6D's digits) and the ship types of the groups, by name; one the service does not list is shown as it is.
  const vesselIdentities = withCurrent(catalog.standardIdentities.filter((i) => vesselIdentityOf(i.code) !== null).map((i) => ({ value: i.code, label: i.name })), vessel === null ? undefined : String(vessel.identity));
  const shipTypes = withCurrent(
    vesselGroups.flatMap((g) => g.shipTypes.map((t) => ({ value: String(t.code), label: `${t.name} (${String(t.code)})` }))),
    vessel === null ? undefined : String(vessel.shipType),
  );
  const echelons = withCurrent(catalog.echelons.map((e) => ({ value: e.code, label: e.name })), parts?.echelonMobility);
  const entityValue = parts === null ? undefined : `${parts.symbolSet}:${parts.entity}`;
  // The entities of the symbol's own category only, so that a name does not repeat (brief, function 4).
  const categories = categoriesOf(catalog.entities);
  const categoryOptions = withCurrent(categories.map((c) => ({ value: c.code, label: c.name })), parts?.symbolSet);
  const entities = withCurrent(
    (categories.find((c) => c.code === parts?.symbolSet)?.entries ?? []).map((e) => ({ value: `${e.symbolSet}:${e.entity}`, label: e.name })),
    entityValue,
  );

  const showPosition = (): string => {
    if (position === null) return '';
    try {
      return coordinates.format(position, format);
    } catch {
      return `${String(position[0])}, ${String(position[1])}`; // a format that cannot express this point: show lon, lat
    }
  };

  return (
    <div className="draw-symbols-panel draw-symbols-form">
      {readOnly && <div className="draw-symbols-wide"><Notice>{readOnlyHint}</Notice></div>}
      {!inView && <div className="draw-symbols-wide"><Notice>Not in view: shown as read from the server. Centre on it from the menu to see it on the map.</Notice></div>}
      <div className="draw-symbols-preview draw-symbols-wide">
        <SymbolPicture symbols={symbols} standard={object.symbol.standard} sidc={object.symbol.sidc} modifiers={object.symbol.modifiers} size={64} withText label="Selected symbol" />
        <span className="draw-symbols-hint">{object.symbol.standard}</span>
      </div>

      {parts !== null && entityValue !== undefined && (
        <>
          <SelectField
            label="Identity"
            value={parts.standardIdentity}
            disabled={readOnly}
            options={identities}
            onChange={(value) => { editParts({ standardIdentity: value }); }}
          />
          {usesEchelon(parts.symbolSet) && (
            <SelectField
              label="Echelon"
              value={parts.echelonMobility}
              disabled={readOnly}
              options={echelons}
              onChange={(value) => { editParts({ echelonMobility: value }); }}
            />
          )}
          <SelectField
            label="Category"
            value={parts.symbolSet}
            disabled={readOnly}
            options={categoryOptions}
            onChange={(value) => {
              // Digits 9 and 10 mean the echelon in land units only, so a symbol that changes its set gets none; the entity is the set's first.
              const first = categories.find((c) => c.code === value)?.entries[0];
              if (first !== undefined) editParts({ symbolSet: value, entity: first.entity, echelonMobility: NO_ECHELON });
            }}
          />
          <SelectField
            label="Entity"
            value={entityValue}
            disabled={readOnly}
            options={entities}
            onChange={(value) => {
              const [symbolSet = '', entity = ''] = value.split(':');
              editParts({ symbolSet, entity });
            }}
          />
        </>
      )}
      {vessel !== null && (
        <>
          <SelectField label="Identity" value={String(vessel.identity)} disabled={readOnly} options={vesselIdentities} onChange={(value) => { const identity = vesselIdentityOf(value); if (identity !== null) editVessel({ identity }); }} />
          <SelectField label="Ship type" value={String(vessel.shipType)} disabled={readOnly} options={shipTypes} onChange={(value) => { editVessel({ shipType: Number(value) }); }} />
        </>
      )}
      <TextField
        label="SIDC"
        data
        value={object.symbol.sidc}
        readOnly={readOnly}
        maxLength={30}
        commit={async (text) => {
          const sidc = text.trim();
          const check = symbols.validate(object.symbol.standard, sidc);
          if (!check.valid) return check.problem ?? `Not a valid ${object.symbol.standard} SIDC.`;
          return edit('change the SIDC', (core) => withSidc(core, sidc));
        }}
      />

      <TextField
        label="Name"
        value={object.properties?.name ?? ''}
        readOnly={readOnly}
        maxLength={MAX_NAME_LENGTH}
        commit={(text) => edit('rename the symbol', (core) => withName(core, text))}
      />
      {EDITABLE_MODIFIERS.map((name) => (
        <TextField
          key={name}
          label={MODIFIER_LABELS[name]}
          value={object.symbol.modifiers?.[name] ?? ''}
          readOnly={readOnly}
          maxLength={MAX_TEXT_LENGTH}
          commit={(text) => edit(`change ${MODIFIER_LABELS[name].toLowerCase()}`, (core) => withModifier(core, name, text))}
        />
      ))}

      <TextField
        label={`Position (${format.toUpperCase()})`}
        data
        value={showPosition()}
        readOnly={readOnly}
        maxLength={100}
        commit={async (text) => {
          const parsed = coordinates.parse(text);
          if ('error' in parsed) return parsed.error;
          const point = validPosition(parsed.position);
          if (point === null) return 'The latitude must be within ±90°.';
          return edit('move the symbol', (core) => withPosition(core, point));
        }}
      />

      <TextField
        label="Heading (°)"
        data
        value={object.symbol.modifiers?.direction === undefined ? '' : String(object.symbol.modifiers.direction)}
        readOnly={readOnly}
        maxLength={MAX_NUMBER_LENGTH}
        commit={(text) => {
          const degrees = parseNumber(text);
          if (degrees === 'invalid') return Promise.resolve('Enter the heading in degrees.');
          if (degrees !== null && (degrees < 0 || degrees >= 360)) return Promise.resolve('The heading must be from 0 to under 360°.');
          return edit('change the heading', (core) => withDirection(core, degrees));
        }}
      />

      <div className="draw-symbols-unit-field">
        <TextField
          label={`Speed (${SPEED_SHORT[speedUnit]})`}
          data
          value={object.symbol.modifiers?.speed === undefined ? '' : speedIn(object.symbol.modifiers.speed, speedUnit)}
          readOnly={readOnly}
          maxLength={MAX_NUMBER_LENGTH}
          commit={(text) => {
            const typed = parseNumber(text);
            if (typed === 'invalid') return Promise.resolve('Enter the speed as a number.');
            if (typed !== null && typed < 0) return Promise.resolve('The speed cannot be negative.');
            const mps = typed === null ? null : speedToMps(typed, speedUnit);
            return edit('change the speed', (core) => withSpeed(core, mps));
          }}
        />
        <SelectField
          label="Speed unit"
          value={speedUnit}
          options={SPEED_UNITS}
          onChange={(value) => {
            if (!isSpeedUnit(value)) return;
            setSpeedUnit(value);
            keepSpeedUnit(value);
          }}
        />
      </div>

      <div className="draw-symbols-unit-field">
        <TextField
          label={`Altitude (${ALTITUDE_SHORT[altitudeUnit]})`}
          data
          value={altitudeOf(object.geometry) === null ? '' : lengthIn(altitudeOf(object.geometry) ?? 0, altitudeUnit)}
          readOnly={readOnly}
          maxLength={MAX_NUMBER_LENGTH}
          commit={(text) => {
            const typed = parseNumber(text);
            if (typed === 'invalid') return Promise.resolve('Enter the altitude as a number.');
            const metres = typed === null ? null : lengthToMetres(typed, altitudeUnit);
            return edit('change the altitude', (core) => withAltitude(core, metres));
          }}
        />
        <SelectField
          label="Altitude unit"
          value={altitudeUnit}
          options={ALTITUDE_UNITS}
          onChange={(value) => {
            if (!isAltitudeUnit(value)) return;
            setAltitudeUnit(value);
            keepAltitudeUnit(value);
          }}
        />
      </div>

      <SelectField
        label="Layer"
        value={object.layerId}
        disabled={readOnly}
        options={withCurrent(layers.filter((l) => l.locked !== true || l.id === object.layerId).map((l) => ({ value: l.id, label: l.name })), object.layerId)} // no locked layer as a target: the store refuses a move into it
        onChange={(value) => { controller.guard(edit('move the symbol to another layer', (core) => withLayer(core, value))); }}
      />

      <SelectField
        label="Data type"
        value={object.dataType}
        disabled={readOnly}
        options={dataTypeOptions(choosableDataTypes(dataTypes, object.dataType), object.dataType)}
        onChange={(value) => { controller.guard(edit('change the data type', (core) => withDataType(core, value))); }}
      />

      {declaredFields.length > 0 && (
        <FieldsEditor object={object} fields={declaredFields} dataTypes={dataTypes} readOnly={readOnly} controller={controller} />
      )}

      <Facts object={object} layers={layers} dataTypes={dataTypes} />
    </div>
  );
}

/** Read-only facts: the layer, the security label, the data source, the version and the last change. */
function Facts(props: {
  readonly object: Pick<MapObject, 'label' | 'version' | 'meta' | 'layerId' | 'dataType' | 'dataSource'>;
  readonly layers: readonly Layer[];
  readonly dataTypes: readonly DataType[];
  /** Also show the data type (for objects whose data type is not edited here). */
  readonly showDataType?: boolean;
}) {
  const { object, layers, dataTypes, showDataType } = props;
  const { at, by } = object.meta.modified;
  const who = by.user === undefined ? by.plugin : `${by.user} (${by.plugin})`;
  return (
    <dl className="draw-symbols-facts draw-symbols-wide">
      <dt>Layer</dt>
      <dd>{layers.find((l) => l.id === object.layerId)?.name ?? object.layerId}</dd>
      {showDataType === true && (
        <>
          <dt>Data type</dt>
          <dd>{dataTypeOptions(dataTypes, object.dataType).find((o) => o.value === object.dataType)?.label ?? object.dataType}</dd>
        </>
      )}
      <dt>Data source</dt>
      <dd>{object.dataSource}</dd>
      <dt>Security label</dt>
      <dd>{object.label.classification} ({object.label.policyIdentifier.name})</dd>
      <dt>Version</dt>
      <dd>{object.version}</dd>
      <dt>Last modified</dt>
      <dd>{at.replace('T', ' ').replace(/\.\d+Z$/, 'Z')} by {who}</dd>
    </dl>
  );
}

/** The available data types by display name; a data type that is not available any more (its plugin was removed) is listed too, marked, so that it is shown and kept. */
function dataTypeOptions(dataTypes: readonly DataType[], current: string): readonly { readonly value: string; readonly label: string }[] {
  const options = dataTypes.map((t) => ({ value: t.id, label: t.name }));
  return options.some((o) => o.value === current) ? options : [...options, { value: current, label: `${current} (not available)` }];
}

/** The options, plus the current value if the list lacks it, so that an unusual value is shown and not replaced by the first option. */
function withCurrent(options: readonly { readonly value: string; readonly label: string }[], current: string | undefined) {
  if (current === undefined || options.some((o) => o.value === current)) return options;
  return [...options, { value: current, label: `Other (${current})` }];
}

function SelectField(props: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
}) {
  return <Select label={props.label} value={props.value} options={props.options} disabled={props.disabled === true} onChange={props.onChange} />;
}

/**
 * A text field that commits on Enter or when it loses focus, not on every key (brief, function 5).
 * While the user has typed something, the field shows that and is not overwritten by live updates;
 * it keeps the input if the change was refused or is not valid. Escape drops what was typed.
 * Read only (no `objects.edit`) shows the field disabled.
 */
function TextField(props: {
  readonly label: string;
  readonly value: string;
  readonly maxLength: number;
  readonly readOnly?: boolean;
  /** Coordinates, SIDCs: the data font. */
  readonly data?: boolean;
  readonly commit: (text: string) => Promise<CommitResult>;
}) {
  const { label, value, maxLength, readOnly, data, commit } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async () => {
    if (draft === null) return;
    const text = draft;
    const result = await commit(text);
    if (result === true) {
      setProblem(null);
      setDraft((current) => (current === text ? null : current)); // keep what was typed meanwhile
    } else {
      setProblem(typeof result === 'string' ? result : null);
    }
  };
  const commitNow = () => {
    run().catch(() => { setProblem('Unexpected error.'); });
  };

  return (
    <div
      className="draw-symbols-field"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        setDraft(null);
        setProblem(null);
      }}
    >
      <SdkTextField
        label={label}
        value={draft ?? value}
        data={data === true}
        disabled={readOnly === true}
        onChange={(text) => { setDraft(text.slice(0, maxLength)); }}
        onCommit={commitNow}
      />
      {problem !== null && <Notice severity="error">{problem}</Notice>}
    </div>
  );
}
