/**
 * A plugin's entry in the Settings list (ADR-0031 point 2): its settings as a form generated from
 * the settings schema it declares, a self-contained panel that could be shown elsewhere too; then
 * the fields it declares, read-only (SDK 1.2.0, {@link DeclaredFieldList}).
 * The schema and the values come from `GET /api/settings/plugins/{id}`; later values from the live
 * picture's `settings` messages, so a change made in another browser shows here as well. A
 * plugin's own settings panel (SDK 1.3.0, `ctx.ui.setSettingsPanel`; T-073) is shown instead of the
 * form; when it has failed, the form is back below a note (owner, 2026-10-30). The panel itself
 * lives in `SettingsPanels.tsx`, so it outlives this view. SDK 1.9.0 (ADR-0064, PQ1 A): a plugin that
 * declares compute threads has their number first ({@link ComputeThreadsField}); one with nothing
 * else to set shows only that.
 */
import type { SettingsSchema } from '@emc2/plugin-sdk';
import { useEffect, useMemo, useState } from 'react';
import { fieldOf, type Field, type JsonObject, type Unusable } from './schema.ts';
import type { ViewServices } from '../services.ts';
import type { SettingsPanelEntry, ShellStore } from '../store.ts';
import { ComputeThreadsField } from './ComputeThreadsField.tsx';
import { CredentialNames } from './credentials.ts';
import { DeclaredFieldList } from './DeclaredFieldList.tsx';
import { ItemList } from './ItemList.tsx';
import { itemFormSchema, itemLists } from './items.ts';
import { SettingsForm } from './SettingsForm.tsx';
import { SettingsPanelSlot } from './SettingsPanels.tsx';
import type { Answer } from './api.ts';

/** The `enabledWhen`s warned of, by plugin and place, so that each is logged once while the page lives (T-128). */
const warned = new Set<string>();

/**
 * Logs a warning, once, for an `enabledWhen` the form cannot use: the field stays enabled (CR-0028
 * part 5; owner, FH); or a `visibleWhen` (SDK 1.5.0 part 4): the field stays shown.
 */
function warnOnce(pluginId: string): Unusable {
  return (path, problem) => {
    const key = `${pluginId} ${path}`;
    if (warned.has(key)) return;
    warned.add(key);
    const visible = path.endsWith('/visibleWhen');
    console.warn(`[core-shell] ${pluginId}'s settings schema: x-emc2.${visible ? 'visibleWhen' : 'enabledWhen'} at ${path} cannot be used (${problem}); `
      + `the field stays ${visible ? 'shown' : 'enabled'}`);
  };
}

type Loaded =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'form'; readonly schema: SettingsSchema; readonly values: JsonObject };

export function PluginSettingsView({ pluginId, services, panel, store, computeThreads = 0, hasSettings = true }: {
  readonly pluginId: string; readonly services: ViewServices;
  /** The plugin's own settings panel, if it set one. */
  readonly panel?: SettingsPanelEntry | undefined; readonly store?: ShellStore | undefined;
  /** SDK 1.9.0: the compute threads its manifest declares; 0 for none. */
  readonly computeThreads?: number;
  /** Whether it has settings of its own; without, only its compute threads show. */
  readonly hasSettings?: boolean;
}) {
  const own = panel !== undefined && store !== undefined && panel.failed === null;
  const compute = computeThreads > 0 ? <ComputeThreadsField pluginId={pluginId} api={services.api} /> : null;
  if (!hasSettings && compute !== null) {
    return <>{compute}<DeclaredFieldList pluginId={pluginId} shared={services.shared} /></>;
  }
  return (
    <>
      {compute}
      {panel?.failed != null && (
        <p role="alert" className="settings-refused">
          The plugin&apos;s own settings panel failed: {panel.failed}. The form below changes the same settings.
        </p>
      )}
      {own ? <SettingsPanelSlot entry={panel} store={store} /> : <PluginSettings pluginId={pluginId} services={services} />}
      <DeclaredFieldList pluginId={pluginId} shared={services.shared} />
    </>
  );
}

function PluginSettings({ pluginId, services }: { readonly pluginId: string; readonly services: ViewServices }) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  useEffect(() => {
    let open = true;
    let fromSocket: JsonObject | null = null;
    const off = services.shared.onSettings(pluginId, (values) => {
      fromSocket = values;
      setLoaded((l) => (l.kind === 'form' ? { ...l, values } : l));
    });
    void services.api.plugin(pluginId).then((answer) => {
      if (!open) return;
      if (!answer.ok) setLoaded({ kind: 'failed', message: answer.message });
      else if (answer.value.schema === null) setLoaded({ kind: 'none' });
      // A message that came while the answer was on its way is newer than the answer.
      else setLoaded({ kind: 'form', schema: answer.value.schema as SettingsSchema, values: fromSocket ?? answer.value.values });
    });
    return () => {
      open = false;
      off();
    };
  }, [pluginId, services]);
  const save = useMemo(() => (values: JsonObject) => services.api.savePlugin(pluginId, values), [pluginId, services]);

  switch (loaded.kind) {
    case 'loading':
      return <p className="muted">Loading the settings…</p>;
    case 'failed':
      return <p role="alert" className="settings-refused">{loaded.message}</p>;
    case 'none':
      return <p className="muted">This plugin has no settings.</p>;
    case 'form':
      return (
        <>
          <p className="muted">The server checks the values when you save them; the plugin gets them at once.</p>
          <PluginForm pluginId={pluginId} schema={loaded.schema} values={loaded.values} services={services} save={save} />
        </>
      );
  }
}

/**
 * The plugin's form (T-203 part D): its top-level lists of objects as tables with a side form, each
 * item its own surface; the other fields as one form with one Save (owner D1 A). A plugin without
 * such a list gets the one form, as before. Problems from the server name the whole settings; each
 * surface shows those below its own place.
 */
function PluginForm({ pluginId, schema, values, services, save }: {
  readonly pluginId: string; readonly schema: SettingsSchema; readonly values: JsonObject; readonly services: ViewServices;
  readonly save: (values: JsonObject) => Promise<Answer<JsonObject>>;
}) {
  const lists = useMemo(() => itemLists(schema), [schema]);
  const listed = useMemo(() => new Set(lists), [lists]);
  const plainSchema = useMemo<SettingsSchema | null>(() => {
    if (lists.length === 0) return schema;
    const properties = Object.fromEntries(Object.entries(schema.properties ?? {}).filter(([key]) => !listed.has(key)));
    if (Object.keys(properties).length === 0) return null;
    const required = Array.isArray(schema.required) ? (schema.required as unknown[]).filter((k) => typeof k !== 'string' || !listed.has(k)) : undefined;
    return { ...schema, properties, ...(required === undefined ? {} : { required }) };
  }, [schema, lists, listed]);
  const plainField = useMemo(() => (plainSchema === null ? null : fieldOf(plainSchema, 'Settings', warnOnce(pluginId))), [plainSchema, pluginId]);
  const listSchemas = useMemo(() => lists.flatMap((key): [string, SettingsSchema, Field][] => {
    const list = schema.properties?.[key];
    return list === undefined ? [] : [[key, list, fieldOf(itemFormSchema(list), list.title ?? key, warnOnce(pluginId), `/properties/${key}/items`)]];
  }), [schema, lists, pluginId]);
  // The plain fields' values: the same object while the values are, so that the form's own checks hold
  const plainValues = useMemo(() => (lists.length === 0 ? values
    : Object.fromEntries(Object.entries(values).filter(([key]) => !listed.has(key)))), [values, lists, listed]);
  const savePlain = useMemo(() => async (plain: JsonObject): Promise<Answer<JsonObject>> => {
    if (lists.length === 0) return save(plain);
    const kept = Object.fromEntries(Object.entries(values).filter(([key]) => listed.has(key)));
    const answer = await save({ ...plain, ...kept });
    return answer.ok ? { ok: true, value: Object.fromEntries(Object.entries(answer.value).filter(([key]) => !listed.has(key))) } : answer;
  }, [save, values, lists, listed]);
  const credentials = useMemo(() => ({ credentials: new CredentialNames(() => services.api.tlsCredentials()) }), [services]);
  const layers = services.layers === undefined ? {} : { layers: services.layers.known };
  const creator = services.layers?.creator === undefined ? {} : { creator: services.layers.creator };
  return (
    <>
      {plainField !== null && (
        <SettingsForm draftKey={`plugin/${pluginId}`} field={plainField} current={plainValues} drafts={services.drafts} save={savePlain} {...credentials}
          {...layers} {...creator} />
      )}
      {listSchemas.map(([key, list, field]) => (
        <ItemList key={key} entryKey={`plugin/${pluginId}`} name={key} list={list} field={field}
          values={values} drafts={services.drafts} save={save} {...layers} {...creator} {...credentials} />
      ))}
    </>
  );
}
