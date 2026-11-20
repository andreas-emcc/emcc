import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, X } from 'lucide-react';
import { Button, canonicalSidc, choosableDataTypes, DeclaredFields, Notice, PanelFoot, Select, TextField, withDataTypeSets } from '@emc2/plugin-sdk';
import type { MilSymbol, SymbolService, SymbolStandard } from '@emc2/plugin-sdk';
import { categoriesOf, NO_ECHELON, usesEchelon, VESSELS, VESSELS_NAME } from './categories.ts';
import type { DrawController } from './controller.ts';
import { keepCategory, readKeptCategory } from './keptChoice.ts';
import { GENERAL_SYMBOLS, GENERAL_SYMBOLS_NAME, keepPalette, OWN_ECHELON, paletteEntries, readKeptPalette } from './palettes.ts';
import { composeChoice, composeVessel } from './symbolParts.ts';
import type { Choice } from './symbolParts.ts';
import { SymbolPicture } from './SymbolPicture.tsx';
import { useDrawState } from './useDrawState.ts';

/** A SIDC is at most 30 characters (APP-6E). */
const MAX_SIDC_LENGTH = 30;

/** The SIDC of a choice, or null if the service cannot compose it (the entity is then shown without an image). */
function tryCompose(symbols: SymbolService, standard: 'APP-6D' | 'APP-6E', choice: Choice): string | null {
  try {
    return composeChoice(symbols, standard, choice);
  } catch {
    return null;
  }
}

/** Control Pane panel "Symbols": the symbol picker and the place button (brief, functions 1 and 2). */
export function SymbolsPanel(props: { readonly controller: DrawController; readonly symbols: SymbolService }) {
  const { controller, symbols } = props;
  const state = useDrawState(controller);
  const { standard, pickerSymbolSize } = state.settings;
  const declaredFields = controller.declaredFields;
  const catalog = useMemo(() => symbols.catalog(), [symbols]);
  const categories = useMemo(() => categoriesOf(catalog.entities), [catalog]);
  // The ship-type groups (SDK 1.4.0, brief function 28; required since the 1.5.0 freeze): they make the category Vessels.
  const vesselGroups = useMemo(() => symbols.vesselGroups(), [symbols]);
  const hasVessels = vesselGroups.length > 0;
  const [identity, setIdentity] = useState(() => (catalog.standardIdentities.find((i) => i.name === 'Friend') ?? catalog.standardIdentities[0])?.code ?? '');
  const [echelon, setEchelon] = useState(() => (catalog.echelons.find((e) => e.code === '00') ?? catalog.echelons[0])?.code ?? '');
  // The category kept in this browser, else the first (brief, function 1).
  const [categoryCode, setCategoryCode] = useState(() => {
    const kept = readKeptCategory();
    if (kept === VESSELS && hasVessels) return VESSELS;
    return (categories.find((c) => c.code === kept) ?? categories[0])?.code ?? '';
  });
  const [entityKey, setEntityKey] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  // The palette chosen (brief, function 31): the general symbols until the kept choice is read; one that is not offered (its plugin is not enabled) counts as the general symbols.
  const palettes = controller.symbolPalettes;
  const [paletteId, setPaletteId] = useState(GENERAL_SYMBOLS);
  const [paletteEchelon, setPaletteEchelon] = useState(OWN_ECHELON);
  const [search, setSearch] = useState('');
  const palette = palettes.find((p) => p.id === paletteId) ?? null;
  const chosenByUser = useRef(false);
  const offered = palettes.length; // by value: the context may hand out a new array on every read, which must not read the document again
  useEffect(() => {
    if (offered === 0) return;
    let live = true;
    void readKeptPalette(controller.userDocuments).then((kept) => {
      if (live && !chosenByUser.current && kept !== null) setPaletteId(kept); // one that is not offered counts as the general symbols (`palette` below)
    });
    return () => { live = false; };
  }, [controller, offered]);
  // The ship type chosen in each group of Vessels (by group id); a group without a choice has its first type.
  const [shipTypes, setShipTypes] = useState<Readonly<Record<string, number>>>({});

  // The echelon applies to land units only: any other symbol set gets none, and a vessel has none.
  const vessels = categoryCode === VESSELS;
  const withEchelon = usesEchelon(categoryCode);
  const activeStandard: SymbolStandard = vessels ? 'vessel' : standard;
  const entities = useMemo(
    () =>
      palette !== null
        ? paletteEntries(symbols, palette, identity, paletteEchelon, search).map((entry) => ({
          name: entry.label, key: entry.key, sidc: entry.sidc, placeSidc: entry.problem === null ? entry.sidc : null, group: null, shipType: undefined, standard: entry.standard, problem: entry.problem,
        }))
        : vessels
        ? vesselGroups.map((group) => {
          const shipType = shipTypes[group.id] ?? group.shipTypes[0]?.code;
          return {
            name: group.label,
            key: `vessel:${group.id}`,
            // The picture is the group's first type, drawn with a direction of 0 so that the hull shows; what is placed has the chosen type and no direction.
            sidc: group.shipTypes[0] === undefined ? null : composeVessel(identity, group.shipTypes[0].code),
            placeSidc: shipType === undefined ? null : composeVessel(identity, shipType),
            group,
            shipType,
            standard: activeStandard,
            problem: null,
          };
        })
        : (categories.find((c) => c.code === categoryCode)?.entries ?? []).map((entry) => {
          const sidc = tryCompose(symbols, standard, {
            standardIdentity: identity,
            echelon: withEchelon ? echelon : NO_ECHELON,
            symbolSet: entry.symbolSet,
            entity: entry.entity,
          });
          return { name: entry.name, key: `${entry.symbolSet}:${entry.entity}`, sidc, placeSidc: sidc, group: null, shipType: undefined, standard: activeStandard, problem: null };
        }),
    [palette, paletteEchelon, search, activeStandard, vessels, vesselGroups, shipTypes, categories, categoryCode, withEchelon, symbols, standard, identity, echelon],
  );

  const chosen = useMemo((): { readonly symbol: MilSymbol | null; readonly problem: string | null } => {
    const text = typed.trim();
    if (text !== '') {
      const check = symbols.validate(activeStandard, text);
      if (!check.valid) return { symbol: null, problem: check.problem ?? `Not a valid ${activeStandard} SIDC.` };
      return { symbol: { standard: activeStandard, sidc: canonicalSidc(activeStandard, text) }, problem: null };
    }
    const found = entities.find((e) => e.key === entityKey);
    if (found === undefined) return { symbol: null, problem: null };
    if (found.placeSidc === null) return { symbol: null, problem: 'This combination of parts cannot be composed.' };
    return { symbol: { standard: found.standard, sidc: found.placeSidc }, problem: null };
  }, [typed, symbols, activeStandard, entities, entityKey]);

  useEffect(() => {
    controller.setPickerSymbol(chosen.symbol);
  }, [controller, chosen.symbol]);

  let status: string | null = state.placeHint;
  if (state.placing) status = state.canPlace ? 'Click the map to place the symbol. Esc stops placing.' : (state.placeHint ?? 'Placing waits for an active layer.'); // after a workspace switch it waits for the new workspace's active layer
  else if (status === null && chosen.symbol === null && chosen.problem === null) status = 'Choose a symbol, or type a SIDC.';

  return (
    <div className="draw-symbols-panel">
      {palettes.length > 0 && (
        <div className="draw-symbols-row">
          <Select
            label="Palette"
            value={palette === null ? GENERAL_SYMBOLS : palette.id}
            options={[{ value: GENERAL_SYMBOLS, label: GENERAL_SYMBOLS_NAME }, ...palettes.map((p) => ({ value: p.id, label: p.name }))]}
            onChange={(id) => {
              chosenByUser.current = true;
              setPaletteId(id);
              setSearch('');
              void keepPalette(controller.userDocuments, id).then((kept) => {
                if (!kept) controller.warn('the palette choice could not be kept for this user');
              });
            }}
          />
        </div>
      )}
      <div className="draw-symbols-row">
        {palette === null && (
          <Select
            label="Category"
            value={categoryCode}
            options={[...categories.map((c) => ({ value: c.code, label: c.name })), ...(hasVessels ? [{ value: VESSELS, label: VESSELS_NAME }] : [])]}
            onChange={(code) => {
              setCategoryCode(code);
              keepCategory(code);
            }}
          />
        )}
        <Select label="Identity" value={identity} options={catalog.standardIdentities.map((i) => ({ value: i.code, label: i.name }))} onChange={setIdentity} />
      </div>

      <div className="draw-symbols-row">
        {palette === null && withEchelon && <Select label="Echelon" value={echelon} options={catalog.echelons.map((e) => ({ value: e.code, label: e.name }))} onChange={setEchelon} />}
        {palette !== null && (
          <Select
            label="Echelon"
            value={paletteEchelon}
            options={[{ value: OWN_ECHELON, label: 'Unchanged' }, ...catalog.echelons.map((e) => ({ value: e.code, label: e.name }))]}
            onChange={setPaletteEchelon}
          />
        )}
        <Select
          label="Data type"
          value={state.dataType}
          options={choosableDataTypes(state.dataTypes).map((t) => ({ value: t.id, label: t.name }))}
          onChange={(id) => { controller.setDataType(id); }}
        />
      </div>

      {declaredFields.length > 0 && (
        // The fields of other plugins for the symbols about to be placed (brief, function 21): they go with each create until changed.
        <DeclaredFields
          fields={declaredFields}
          values={state.placeFields}
          onChange={(values) => { controller.setPlaceFields(values); }}
          dataType={state.dataType}
          pluginId={controller.pluginId}
          readOnly={!state.canEdit}
          fieldSets={controller.fieldSets}
          dataTypes={state.dataTypes}
          objectSets={withDataTypeSets(state.placeSets, state.dataTypes.find((t) => t.id === state.dataType))}
          onAddSet={(setId) => { controller.addPlaceSet(setId); }}
        />
      )}

      {palette !== null && <TextField label="Search" value={search} onChange={setSearch} />}

      <div className="draw-symbols-grid" role="group" aria-label="Symbols">
        {entities.map(({ name, key, sidc, group, shipType, standard: entryStandard, problem }) => {
          const button = (
            <button
              type="button"
              className="draw-symbols-entity"
              aria-pressed={typed.trim() === '' && key === entityKey}
              disabled={problem !== null}
              {...(problem === null ? {} : { title: problem })}
              onClick={() => {
                setTyped('');
                setEntityKey(key);
              }}
            >
              {problem !== null && <span className="draw-symbols-picture-missing" aria-hidden="true">?</span>}
              {problem === null && sidc !== null && (
                <SymbolPicture symbols={symbols} standard={entryStandard} sidc={sidc} {...(vessels ? { modifiers: { direction: 0 } } : {})} size={pickerSymbolSize} label={null} />
              )}
              <span className="draw-symbols-entity-name">{name}</span>
            </button>
          );
          if (group === null) return <Fragment key={key}>{button}</Fragment>;
          // A vessel group: its ship type is chosen under it, and choosing one chooses the group.
          return (
            <div key={key} className="draw-symbols-vessel" role="group" aria-label={name}>
              {button}
              <Select
                label="Ship type"
                value={String(shipType ?? '')}
                options={group.shipTypes.map((t) => ({ value: String(t.code), label: t.name }))}
                onChange={(value) => {
                  setShipTypes((prev) => ({ ...prev, [group.id]: Number(value) }));
                  setTyped('');
                  setEntityKey(key);
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="draw-symbols-preview">
        {chosen.symbol !== null ? (
          <>
            <SymbolPicture symbols={symbols} standard={chosen.symbol.standard} sidc={chosen.symbol.sidc} size={Math.min(pickerSymbolSize * 2, 128)} label="Preview of the chosen symbol" />
            <code>{chosen.symbol.sidc}</code>
          </>
        ) : (
          <span className="draw-symbols-hint">No symbol chosen</span>
        )}
      </div>

      <details className="draw-symbols-advanced">
        <summary>Advanced: type a SIDC</summary>
        <TextField label={`SIDC (${activeStandard})`} value={typed} data onChange={(text) => { setTyped(text.slice(0, MAX_SIDC_LENGTH)); }} />
      </details>
      {chosen.problem !== null && <Notice severity="error">{chosen.problem}</Notice>}

      {status !== null && <Notice>{status}</Notice>}
      {/* Place applies to the whole panel: the foot, last in the body (SDK 1.8.0 part C; T-204). */}
      <PanelFoot>
        <Button
          variant={state.placing ? 'normal' : 'primary'}
          icon={state.placing ? X : MapPin}
          disabled={!state.placing && !state.canPlace}
          {...(!state.placing && !state.canPlace && state.placeHint !== null ? { title: state.placeHint } : {})}
          onClick={() => { controller.setPlacing(!state.placing); }}
        >
          {state.placing ? 'Stop placing' : 'Place on map'}
        </Button>
      </PanelFoot>
    </div>
  );
}
