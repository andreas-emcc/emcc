// The plugin's own settings panel (CR-0023, ADR-0035 point 4), shown instead of the generated form: servers, backgrounds,
// and for each background the checkbox list of its server's layers with their drawing order. It edits the whole settings
// and saves them with `save(values)`; ECore validates them and checks `settings.admin`.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { ChevronDown, ChevronUp, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button, Checkbox, IconButton, Notice, Select, TextField } from '@emc2/plugin-sdk';
import type { Settings, SettingsPanelProps, SettingsProblem } from '@emc2/plugin-sdk';
import { fetchLayers, type LayerList } from './layers.ts';
import {
  DEFAULT_TIMEOUT,
  backgroundsUsing,
  canonical,
  commonProjections,
  draftKey,
  fromSettings,
  makeId,
  newKey,
  problems,
  toSettings,
  withIds,
  type Background,
  type Draft,
  type FieldProblem,
  type ImageFormat,
  type Mode,
  type Server,
  type WmsVersion,
} from './settings.ts';

export interface Props extends SettingsPanelProps {
  readonly serverBase: string;
}

interface PanelState {
  readonly draft: Draft;
  /** The canonical text of the saved settings the draft started from. */
  readonly baseline: string;
  /** Another admin's values, while this panel has unsaved changes. */
  readonly theirs: Settings | null;
  /** The canonical text of what this panel is saving now, so that its own save is not taken for another admin's. */
  readonly pending: string | null;
  readonly saving: boolean;
  /** Whether the checks of {@link problems} are shown: after the first try to save. */
  readonly showChecks: boolean;
  readonly refused: readonly SettingsProblem[];
  readonly message: { readonly text: string; readonly severity: 'info' | 'error' } | null;
}

const EMPTY_LIST: LayerList = { layers: [], readAt: null, error: null, reading: false };
const MAX_REREADS = 5;
const REREAD_MS = 2_000;

type LayerState = { readonly status: 'loading' | 'ready' | 'failed'; readonly list: LayerList; readonly message: string | null };

export function SettingsPanel(props: Props): ReactNode {
  const { values, serverBase } = props;
  const incoming = useMemo(() => canonical(values), [values]);
  const [state, setState] = useState<PanelState>(() => ({
    draft: fromSettings(values),
    baseline: incoming,
    theirs: null,
    pending: null,
    saving: false,
    showChecks: false,
    refused: [],
    message: null,
  }));
  const [seen, setSeen] = useState(incoming);
  // New saved values: our own save (already known), another admin's (kept apart while there are unsaved changes), or none.
  if (seen !== incoming) {
    setSeen(incoming);
    setState((s) => {
      if (incoming === s.baseline) return s;
      if (s.pending === incoming) return { ...s, baseline: incoming, pending: null };
      if (draftKey(s.draft) === s.baseline) return { ...s, baseline: incoming, draft: fromSettings(values), theirs: null };
      return { ...s, theirs: values };
    });
  }

  const unsaved = draftKey(state.draft) !== state.baseline;
  useEffect(() => {
    props.markUnsaved(unsaved);
    // `markUnsaved` is the shell's and may be a new function at each render; only a change of the flag matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unsaved]);

  const saved = useMemo(() => fromSettings(values), [values]);
  const setDraft = (change: (draft: Draft) => Draft) => {
    setState((s) => ({ ...s, draft: change(s.draft), message: null }));
  };

  // ---- the layers of the saved servers
  const [layerStates, setLayerStates] = useState<Readonly<Record<string, LayerState>>>({});
  const requested = useRef(new Set<string>());
  const load = (serverId: string, signature: string, refresh: boolean, attempt = 0) => {
    setLayerStates((all) => ({ ...all, [signature]: { status: 'loading', list: all[signature]?.list ?? EMPTY_LIST, message: null } }));
    fetchLayers(serverBase, serverId, refresh).then(
      (list) => {
        setLayerStates((all) => ({ ...all, [signature]: { status: 'ready', list, message: null } }));
        // The server part may still be reading after a save: look again soon.
        if (list.reading && attempt < MAX_REREADS) setTimeout(() => { load(serverId, signature, false, attempt + 1); }, REREAD_MS);
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setLayerStates((all) => ({ ...all, [signature]: { status: 'failed', list: all[signature]?.list ?? EMPTY_LIST, message } }));
      },
    );
  };
  /** A saved server is known to the server part by its id; the layers belong to its saved address and version. */
  const signatureOf = (server: Server): string | null => {
    const match = saved.servers.find((s) => s.id === server.id && s.url === server.url.trim() && s.version === server.version);
    return match?.id === undefined ? null : `${match.id}|${match.url}|${match.version}`;
  };
  const wanted = state.draft.backgrounds.flatMap((b) => {
    const server = state.draft.servers.find((s) => s.id === b.server);
    const signature = server === undefined ? null : signatureOf(server);
    return server?.id === undefined || signature === null ? [] : [`${server.id}\n${signature}`];
  });
  const wantedKey = [...new Set(wanted)].join('\n\n');
  useEffect(() => {
    if (wantedKey === '') return;
    for (const entry of wantedKey.split('\n\n')) {
      const [id = '', signature = ''] = entry.split('\n');
      if (!requested.current.has(signature)) {
        requested.current.add(signature);
        load(id, signature, false);
      }
    }
    // `load` only needs the base address, which does not change while the panel lives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey]);

  // ---- saving
  const onSave = () => {
    const withId = withIds(state.draft);
    if (problems(withId).length > 0) {
      setState((s) => ({ ...s, showChecks: true, refused: [], message: null }));
      return;
    }
    const toSave = toSettings(withId);
    const pending = canonical(toSave);
    setState((s) => ({ ...s, draft: withId, pending, saving: true, showChecks: false, refused: [], message: null }));
    props.save(toSave).then(
      (result) => {
        if (result.ok) {
          setState((s) => ({
            ...s,
            // Edits made while saving stay.
            draft: draftKey(s.draft) === draftKey(withId) ? fromSettings(result.values) : s.draft,
            baseline: canonical(result.values),
            theirs: null,
            pending: null,
            saving: false,
            message: { text: 'Saved.', severity: 'info' },
          }));
        } else {
          setState((s) => ({ ...s, pending: null, saving: false, refused: result.problems }));
        }
      },
      (error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        setState((s) => ({ ...s, pending: null, saving: false, message: { text: `Saving failed: ${reason}`, severity: 'error' } }));
      },
    );
  };
  const onDiscard = () => {
    setState((s) => ({ ...s, draft: fromSettings(values), baseline: incoming, theirs: null, showChecks: false, refused: [], message: null }));
  };
  const takeTheirs = () => {
    setState((s) => (s.theirs === null ? s : { ...s, draft: fromSettings(s.theirs), baseline: canonical(s.theirs), theirs: null, showChecks: false, refused: [] }));
  };

  // ---- what to show at each field
  const checks: readonly FieldProblem[] = state.showChecks ? problems(withIds(state.draft)) : [];
  const errorAt = (path: string): string | undefined =>
    checks.find((p) => p.path === path)?.problem ?? state.refused.find((p) => p.path === path)?.problem;

  return (
    <div className="basemap-wms-panel">
      <div className="basemap-wms-actions">
        <Button variant="primary" onClick={onSave} disabled={!unsaved || state.saving} {...(unsaved ? {} : { title: 'There is nothing to save' })}>
          Save
        </Button>
        <Button onClick={onDiscard} disabled={!unsaved || state.saving} {...(unsaved ? {} : { title: 'There is nothing to discard' })}>
          Discard
        </Button>
        {unsaved ? <span className="basemap-wms-unsaved">Unsaved changes</span> : null}
      </div>
      {state.message === null ? null : <Notice severity={state.message.severity}>{state.message.text}</Notice>}
      {state.theirs === null ? null : (
        <Notice severity="warning">
          <span>The settings were changed by someone else. Your changes are kept.</span>{' '}
          <Button onClick={takeTheirs}>Take their values</Button>
        </Notice>
      )}
      {state.refused.length === 0 ? null : (
        <Notice severity="error">
          <span>The server refused the values; nothing was changed.</span>
          <ul className="basemap-wms-problems">
            {state.refused.map((p, i) => (
              <li key={`${p.path}-${String(i)}`}>
                {p.path}: {p.problem}
              </li>
            ))}
          </ul>
        </Notice>
      )}
      {checks.length === 0 ? null : <Notice severity="error">Some values need attention; they are marked below.</Notice>}

      <section className="basemap-wms-section" aria-label="Servers">
        <h3 className="basemap-wms-heading">Servers</h3>
        {state.draft.servers.length === 0 ? <p className="basemap-wms-hint">No server yet. Add the WMS server that serves your maps.</p> : null}
        {state.draft.servers.map((server, i) => (
          <ServerCard
            key={server.key ?? server.id ?? String(i)}
            server={server}
            index={i}
            usedBy={backgroundsUsing(state.draft, server.id)}
            errorAt={errorAt}
            onChange={(next) => { setDraft((d) => changeServer(d, i, next)); }}
            onRemove={() => { setDraft((d) => ({ ...d, servers: d.servers.filter((_, j) => j !== i) })); }}
          />
        ))}
        <div>
          <Button
            icon={Plus}
            onClick={() => {
              setDraft((d) => ({ ...d, servers: [...d.servers, { key: newKey(), id: makeId('', new Set(d.servers.flatMap((s) => (s.id === undefined ? [] : [s.id]))), 'server'), isNew: true, name: '', url: '', version: '1.3.0', timeout: String(DEFAULT_TIMEOUT) }] }));
            }}
          >
            Add server
          </Button>
        </div>
      </section>

      <section className="basemap-wms-section" aria-label="Backgrounds">
        <h3 className="basemap-wms-heading">Backgrounds</h3>
        {state.draft.backgrounds.length === 0 ? <p className="basemap-wms-hint">No background yet. A background is one server, some of its layers and a name.</p> : null}
        {state.draft.backgrounds.map((background, i) => {
          const server = state.draft.servers.find((s) => s.id === background.server);
          const signature = server === undefined ? null : signatureOf(server);
          return (
            <BackgroundCard
              key={background.key ?? background.id ?? String(i)}
              background={background}
              index={i}
              servers={state.draft.servers}
              serverSaved={signature !== null}
              layerState={signature === null ? undefined : layerStates[signature]}
              errorAt={errorAt}
              onChange={(next) => { setDraft((d) => ({ ...d, backgrounds: d.backgrounds.map((b, j) => (j === i ? next : b)) })); }}
              onRemove={() => { setDraft((d) => ({ ...d, backgrounds: d.backgrounds.filter((_, j) => j !== i) })); }}
              onReread={() => {
                if (server?.id !== undefined && signature !== null) load(server.id, signature, true);
              }}
            />
          );
        })}
        <div>
          <Button
            icon={Plus}
            onClick={() => {
              setDraft((d) => ({
                ...d,
                backgrounds: [
                  ...d.backgrounds,
                  { key: newKey(), name: '', server: d.servers.length === 1 ? (d.servers[0]?.id ?? '') : '', layers: [], mode: 'tiles', format: 'image/png', transparent: false, attributionText: '', attributionUrl: '' },
                ],
              }));
            }}
          >
            Add background
          </Button>
        </div>
      </section>
    </div>
  );
}

/** The shared text field with an optional error (the SDK's types do not take an explicit `undefined`). */
function Field(props: Omit<ComponentProps<typeof TextField>, 'error'> & { readonly error: string | undefined }): ReactNode {
  const { error, ...rest } = props;
  return <TextField {...rest} {...(error === undefined ? {} : { error })} />;
}

/** A change to a server; a server that is not saved yet gets a new id from its new name, and the backgrounds that use it follow. */
function changeServer(draft: Draft, index: number, next: Server): Draft {
  const old = draft.servers[index];
  if (old === undefined) return draft;
  let server = next;
  let backgrounds = draft.backgrounds;
  if (old.isNew === true && next.name !== old.name) {
    const taken = new Set(draft.servers.flatMap((s, j) => (j === index || s.id === undefined ? [] : [s.id])));
    const id = makeId(next.name, taken, 'server');
    server = { ...next, id };
    if (old.id !== undefined && id !== old.id) backgrounds = draft.backgrounds.map((b) => (b.server === old.id ? { ...b, server: id } : b));
  }
  return { servers: draft.servers.map((s, j) => (j === index ? server : s)), backgrounds };
}

function ServerCard(props: {
  readonly server: Server;
  readonly index: number;
  readonly usedBy: readonly string[];
  readonly errorAt: (path: string) => string | undefined;
  readonly onChange: (server: Server) => void;
  readonly onRemove: () => void;
}): ReactNode {
  const { server, index, usedBy, errorAt, onChange } = props;
  const at = `/servers/${String(index)}`;
  const label = server.name.trim() === '' ? 'New server' : server.name.trim();
  const blocked = usedBy.length > 0;
  return (
    <section className="basemap-wms-card" aria-label={`Server ${label}`}>
      <div className="basemap-wms-card-head">
        <h4 className="basemap-wms-card-title">{label}</h4>
        <IconButton
          icon={Trash2}
          label={`Remove server ${label}`}
          disabled={blocked}
          title={blocked ? `Used by ${usedBy.map((n) => `“${n}”`).join(', ')}: remove those backgrounds or give them another server first` : `Remove server ${label}`}
          onClick={props.onRemove}
        />
      </div>
      <Field label="Name" value={server.name} onChange={(name) => { onChange({ ...server, name }); }} error={errorAt(`${at}/name`)} spellCheck={false} />
      <Field
        label="Address"
        value={server.url}
        placeholder="http://127.0.0.1:8280/geoserver/ows"
        onChange={(url) => { onChange({ ...server, url }); }}
        error={errorAt(`${at}/url`)}
        data
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
      />
      <Select<WmsVersion>
        label="WMS version"
        value={server.version}
        options={[{ value: '1.3.0', label: '1.3.0' }, { value: '1.1.1', label: '1.1.1' }]}
        onChange={(version) => { onChange({ ...server, version }); }}
      />
      <Field
        label="Timeout (seconds)"
        value={server.timeout}
        onChange={(timeout) => { onChange({ ...server, timeout }); }}
        error={errorAt(`${at}/timeoutSeconds`)}
        data
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
      />
      {errorAt(at) === undefined ? null : <span className="basemap-wms-error">{errorAt(at)}</span>}
    </section>
  );
}

function BackgroundCard(props: {
  readonly background: Background;
  readonly index: number;
  readonly servers: readonly Server[];
  readonly serverSaved: boolean;
  readonly layerState: LayerState | undefined;
  readonly errorAt: (path: string) => string | undefined;
  readonly onChange: (background: Background) => void;
  readonly onRemove: () => void;
  readonly onReread: () => void;
}): ReactNode {
  const { background, index, servers, errorAt, onChange, layerState } = props;
  const at = `/backgrounds/${String(index)}`;
  const label = background.name.trim() === '' ? 'New background' : background.name.trim();
  const list = layerState?.status === 'ready' ? layerState.list : EMPTY_LIST;
  const known = new Set(list.layers.map((l) => l.name));
  const missing = background.layers.filter((name) => layerState?.status === 'ready' && !known.has(name));
  const projections = commonProjections(background.layers, list.layers);
  const toggle = (name: string, on: boolean) => {
    onChange({ ...background, layers: on ? [...background.layers, name] : background.layers.filter((l) => l !== name) });
  };
  /** Moves a layer one step towards the top (`+1` in the stored order, which is bottom first) or the bottom (`-1`). */
  const move = (position: number, by: 1 | -1) => {
    const next = [...background.layers];
    const [layer] = next.splice(position, 1);
    if (layer === undefined) return;
    next.splice(position + by, 0, layer);
    onChange({ ...background, layers: next });
  };
  const titleOf = (name: string) => list.layers.find((l) => l.name === name)?.title ?? name;
  const topFirst = background.layers.map((name, position) => ({ name, position })).reverse();

  return (
    <section className="basemap-wms-card" aria-label={`Background ${label}`}>
      <div className="basemap-wms-card-head">
        <h4 className="basemap-wms-card-title">{label}</h4>
        <IconButton icon={Trash2} label={`Remove background ${label}`} onClick={props.onRemove} />
      </div>
      <Field label="Name" value={background.name} onChange={(name) => { onChange({ ...background, name }); }} error={errorAt(`${at}/name`)} spellCheck={false} />
      <Select<string>
        label="Server"
        value={background.server}
        options={[{ value: '', label: 'Choose a server' }, ...servers.flatMap((s) => (s.id === undefined ? [] : [{ value: s.id, label: s.name.trim() === '' ? s.id : s.name.trim() }]))]}
        onChange={(server) => { onChange({ ...background, server, layers: server === background.server ? background.layers : [] }); }}
      />
      {errorAt(`${at}/server`) === undefined ? null : <span className="basemap-wms-error">{errorAt(`${at}/server`)}</span>}
      <Select<Mode>
        label="Maps are drawn as"
        value={background.mode}
        options={[{ value: 'tiles', label: 'Tiles' }, { value: 'image', label: 'One image per view' }]}
        onChange={(mode) => { onChange({ ...background, mode }); }}
      />
      <Select<ImageFormat>
        label="Image format"
        value={background.format}
        options={[{ value: 'image/png', label: 'PNG' }, { value: 'image/jpeg', label: 'JPEG' }]}
        onChange={(format) => { onChange({ ...background, format, transparent: format === 'image/png' ? background.transparent : false }); }}
      />
      <Checkbox
        label="Transparent (PNG only)"
        checked={background.transparent}
        disabled={background.format !== 'image/png'}
        onChange={(transparent) => { onChange({ ...background, transparent }); }}
      />
      <Field
        label="Attribution text"
        value={background.attributionText}
        onChange={(attributionText) => { onChange({ ...background, attributionText }); }}
        error={errorAt(`${at}/attribution/text`)}
        spellCheck={false}
      />
      <Field
        label="Attribution link (optional)"
        value={background.attributionUrl}
        onChange={(attributionUrl) => { onChange({ ...background, attributionUrl }); }}
        error={errorAt(`${at}/attribution/url`)}
        data
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
      />

      <div className="basemap-wms-layers" role="group" aria-label={`Layers of ${label}`}>
        <h5 className="basemap-wms-subheading">Layers</h5>
        {background.server === '' ? (
          <p className="basemap-wms-hint">Choose a server to see its layers.</p>
        ) : !props.serverSaved ? (
          <p className="basemap-wms-hint">Save the server to see its layers</p>
        ) : layerState === undefined || (layerState.status === 'loading' && layerState.list.layers.length === 0) ? (
          <p className="basemap-wms-hint">Reading the layers…</p>
        ) : (
          <>
            {layerState.status === 'failed' ? <Notice severity="error">{layerState.message}</Notice> : null}
            {list.error === null ? null : <Notice severity="warning">{`The server could not be read: ${list.error}`}</Notice>}
            <ul className="basemap-wms-layer-list" aria-label="Layers on the server">
              {list.layers.map((layer) => (
                <li key={layer.name} className="basemap-wms-layer">
                  <Checkbox label={`${layer.title} (${layer.name})`} checked={background.layers.includes(layer.name)} onChange={(on) => { toggle(layer.name, on); }} />
                  <span className="basemap-wms-projections">{layer.projections.join(', ')}</span>
                </li>
              ))}
              {missing.map((name) => (
                <li key={`missing-${name}`} className="basemap-wms-layer basemap-wms-layer-missing">
                  <Checkbox label={`${name} (missing on the server)`} checked onChange={(on) => { toggle(name, on); }} />
                </li>
              ))}
            </ul>
            <div>
              <Button icon={RefreshCw} onClick={props.onReread} disabled={layerState.status === 'loading'}>
                Read the layers again
              </Button>
              {list.readAt === null ? null : <span className="basemap-wms-hint">{` Read ${list.readAt}`}</span>}
            </div>
          </>
        )}
        {topFirst.length === 0 ? null : (
          <>
            <h5 className="basemap-wms-subheading">Drawing order, top-most first</h5>
            <ol className="basemap-wms-order" aria-label={`Drawing order of ${label}, top-most first`}>
              {topFirst.map(({ name, position }) => (
                <li key={name} className="basemap-wms-order-row">
                  <span className="basemap-wms-order-name">{titleOf(name)}</span>
                  <IconButton
                    icon={ChevronUp}
                    label={`Move up ${name}`}
                    disabled={position === background.layers.length - 1}
                    title={position === background.layers.length - 1 ? 'Already the top-most layer' : `Move up ${name}`}
                    onClick={() => { move(position, 1); }}
                  />
                  <IconButton
                    icon={ChevronDown}
                    label={`Move down ${name}`}
                    disabled={position === 0}
                    title={position === 0 ? 'Already the bottom layer' : `Move down ${name}`}
                    onClick={() => { move(position, -1); }}
                  />
                </li>
              ))}
            </ol>
          </>
        )}
        {errorAt(`${at}/layers`) === undefined ? null : <span className="basemap-wms-error">{errorAt(`${at}/layers`)}</span>}
        <p className="basemap-wms-hint">
          {projections === null
            ? 'Offered in: known once the layers are read.'
            : projections.length === 0
              ? 'Offered in: no projection that all chosen layers share.'
              : `Offered in: ${projections.join(', ')}`}
        </p>
      </div>
    </section>
  );
}
