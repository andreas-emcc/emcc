// The Event panel (brief function 22; Q14, A44): an event's kind, its objects, and for "change
// fields" the core fields and the shared DeclaredFields editor (ADR-0038 point 5).
import { useSyncExternalStore } from 'react';
import { Plus, X } from 'lucide-react';
import { Button, Checkbox, DeclaredFields, IconButton, Notice, PanelFoot, Select, TextField } from '@emc2/plugin-sdk';
import { SimPanel } from './SimPanel.tsx';
import type { DataType, DeclaredField, FieldSet, SymbolService, TextModifierName } from '@emc2/plugin-sdk';
import { extensionOf, listedObjects } from './definition.ts';
import type { RouteEditorModel } from './editor.ts';
import { formProblems, modifierLabel, TEXT_MODIFIERS } from './events.ts';
import type { CoreMode, CoreValue, EventForm, EventModel, TextRow } from './events.ts';
import { FailureNotice } from './FailureNotice.tsx';
import { useModel } from './model.ts';
import { EDIT_HINT, lockedHint } from './permissions.ts';
import type { Rights } from './permissions.ts';
import { PLUGIN_ID } from './picture.ts';
import type { SimulationPicture } from './picture.ts';
import { objectName } from './RouteEditorPanel.tsx';

const KINDS = [
  { value: 'set', label: 'Change fields' },
  { value: 'hide', label: 'Hide' },
] as const;

const MODES: readonly { readonly value: CoreMode; readonly label: string }[] = [
  { value: 'keep', label: 'Leave as it is' },
  { value: 'set', label: 'Set to' },
  { value: 'clear', label: 'Clear it' },
];

const MODIFIERS = TEXT_MODIFIERS.map((name) => ({ value: name, label: modifierLabel(name) }));

/**
 * The data type the event's objects share (every object on the route when none is chosen), else
 * `core.general` (function 35). Objects not in the picture are left out.
 */
export function sharedDataType(picture: SimulationPicture, ids: readonly string[]): string {
  const types = new Set(ids.flatMap((id) => {
    const o = picture.object(id);
    return o === undefined ? [] : [o.dataType];
  }));
  const [only] = types;
  return types.size === 1 && only !== undefined ? only : 'core.general';
}

export function EventPanel(props: {
  readonly model: EventModel;
  readonly editor: RouteEditorModel;
  readonly picture: SimulationPicture;
  readonly declaredFields: readonly DeclaredField[];
  /** SDK 1.4.0: every declared field set; an event may set the fields of any of them (the owner, 2026-11-06). */
  readonly fieldSets: readonly FieldSet[];
  /** SDK 1.5.0: the data types with their sets (`ctx.dataTypes`), so the fields open on the shared type's first set (function 35). */
  readonly dataTypes: () => readonly DataType[];
  readonly symbols: () => SymbolService | null;
  readonly rights: Rights;
}) {
  const { model, picture } = props;
  const state = useModel(model);
  useSyncExternalStore(picture.onChange, picture.revision);
  const route = state.routeId === null ? undefined : picture.object(state.routeId);
  // Read only without the edit right, or for everyone while the route's layer is locked (function 25, A82).
  const locked = route === undefined ? null : picture.lockedLayer(route.layerId);
  const hint = !props.rights.edit ? EDIT_HINT : locked === null ? null : lockedHint(locked.name);
  const readOnly = hint !== null;
  const form = state.form;
  const problems = formProblems(form, props.declaredFields, props.symbols());
  const listed = route === undefined ? [] : listedObjects(extensionOf(route));
  // Objects the event names that are no longer on the route are shown too, so that they can be unchosen.
  const gone = form.objects.filter((id) => !listed.some((o) => o.id === id.toLowerCase()));
  const onRoute = [...listed.map((o) => ({ id: o.id, label: objectName(picture, o.id) })), ...gone.map((id) => ({ id, label: `${objectName(picture, id)} (not on the route)` }))];
  const chosen = new Set(form.objects);
  const dataType = sharedDataType(picture, form.objects.length === 0 ? onRoute.map((o) => o.id) : form.objects);
  const set = (patch: Partial<EventForm>) => {
    model.setForm(patch);
  };

  return (
    <SimPanel
      label="Event"
      actions={<IconButton icon={X} label="Close the event" onClick={() => { model.close(); }} />}
      foot={
        <PanelFoot>
          <Button
            variant="primary"
            disabled={readOnly || state.busy || route === undefined || Object.keys(problems).length > 0}
            {...(hint === null ? {} : { title: hint })}
            onClick={() => void model.save(problems)}
          >
            Save
          </Button>
          <Button onClick={() => { model.close(); }}>Cancel</Button>
        </PanelFoot>
      }
    >
      <div className="simulator-panel">
        <p className="simulator-muted">{`At point ${String(state.point + 1)}`}</p>
        {hint === null ? null : <Notice>{hint}</Notice>}
        {route === undefined ? <Notice severity="warning">The route no longer exists</Notice> : null}
        <Select label="Kind" value={form.kind} options={KINDS} disabled={readOnly} onChange={(kind) => { set({ kind }); }} />
        <fieldset className="simulator-fieldset">
          <legend className="simulator-heading">Objects</legend>
          <p className="simulator-muted">None chosen: every object on the route, as it passes the point.</p>
          {onRoute.length === 0 ? <p className="simulator-muted">The route has no objects yet.</p> : null}
          {onRoute.map((o) => (
            <Checkbox
              key={o.id}
              label={o.label}
              checked={chosen.has(o.id)}
              disabled={readOnly}
              onChange={(on) => { set({ objects: on ? [...form.objects, o.id] : form.objects.filter((id) => id !== o.id) }); }}
            />
          ))}
        </fieldset>
        {form.kind === 'hide' ? (
          <p className="simulator-text">The object stops, is shown faded, and is no longer sent to the outputs, until a reset or "Put on route".</p>
        ) : (
          <>
            <CoreField label="Name" value={form.name} error={problems['name']} readOnly={readOnly} onChange={(name) => { set({ name }); }} />
            <CoreField label="Description" value={form.description} error={problems['description']} readOnly={readOnly} onChange={(description) => { set({ description }); }} />
            <CoreField label="SIDC" value={form.sidc} error={problems['sidc']} readOnly={readOnly} noClear onChange={(sidc) => { set({ sidc }); }} />
            <fieldset className="simulator-fieldset">
              <legend className="simulator-heading">Text modifiers</legend>
              {form.texts.map((row, i) => (
                <TextModifierRow
                  key={i}
                  row={row}
                  error={problems[`texts.${String(i)}`]}
                  readOnly={readOnly}
                  onChange={(next) => { set({ texts: form.texts.map((r, j) => (j === i ? next : r)) }); }}
                  onRemove={() => { set({ texts: form.texts.filter((_, j) => j !== i) }); }}
                />
              ))}
              <Button icon={Plus} disabled={readOnly} onClick={() => { set({ texts: [...form.texts, { name: firstFree(form.texts), mode: 'set', text: '' }] }); }}>
                Add text modifier
              </Button>
            </fieldset>
            <DeclaredFields
              key={state.opened}
              fields={props.declaredFields}
              fieldSets={props.fieldSets}
              dataTypes={props.dataTypes()}
              objectSets={props.fieldSets.map((s) => s.id)}
              values={form.fields}
              onChange={(fields) => { model.setFields(fields); }}
              dataType={dataType}
              pluginId={PLUGIN_ID}
              readOnly={readOnly}
            />
          </>
        )}
        {problems['form'] === undefined || readOnly ? null : <Notice>{problems['form']}</Notice>}
        <FailureNotice failure={state.failure} onDismiss={() => { model.dismissFailure(); }} />
      </div>
    </SimPanel>
  );
}

function firstFree(rows: readonly TextRow[]): TextModifierName {
  return TEXT_MODIFIERS.find((m) => !rows.some((r) => r.name === m)) ?? 'uniqueDesignation';
}

function CoreField(props: {
  readonly label: string;
  readonly value: CoreValue;
  readonly error: string | undefined;
  readonly readOnly: boolean;
  readonly noClear?: boolean;
  readonly onChange: (value: CoreValue) => void;
}) {
  const { value } = props;
  return (
    <div className="simulator-fields">
      <Select
        label={props.label}
        value={value.mode}
        options={props.noClear === true ? MODES.filter((m) => m.value !== 'clear') : MODES}
        disabled={props.readOnly}
        onChange={(mode) => { props.onChange({ ...value, mode }); }}
      />
      {value.mode === 'set' ? (
        <TextField
          label={`New ${props.label.toLowerCase()}`}
          value={value.text}
          onChange={(text) => { props.onChange({ ...value, text }); }}
          {...(props.error === undefined ? {} : { error: props.error })}
          readOnly={props.readOnly}
          spellCheck={false}
          autoComplete="off"
        />
      ) : null}
    </div>
  );
}

function TextModifierRow(props: {
  readonly row: TextRow;
  readonly error: string | undefined;
  readonly readOnly: boolean;
  readonly onChange: (row: TextRow) => void;
  readonly onRemove: () => void;
}) {
  const { row } = props;
  return (
    <div className="simulator-fields">
      <Select label="Modifier" value={row.name} options={MODIFIERS} disabled={props.readOnly} onChange={(name) => { props.onChange({ ...row, name }); }} />
      <Select
        label="Change"
        value={row.mode}
        options={MODES.filter((m) => m.value !== 'keep') as readonly { readonly value: 'set' | 'clear'; readonly label: string }[]}
        disabled={props.readOnly}
        onChange={(mode) => { props.onChange({ ...row, mode }); }}
      />
      {row.mode === 'set' ? (
        <TextField
          label={`New ${modifierLabel(row.name).toLowerCase()}`}
          value={row.text}
          onChange={(text) => { props.onChange({ ...row, text }); }}
          {...(props.error === undefined ? {} : { error: props.error })}
          readOnly={props.readOnly}
          spellCheck={false}
          autoComplete="off"
        />
      ) : props.error === undefined ? null : (
        <span className="simulator-muted">{props.error}</span>
      )}
      <IconButton icon={X} label={`Remove ${modifierLabel(row.name).toLowerCase()}`} disabled={props.readOnly} onClick={props.onRemove} />
    </div>
  );
}
