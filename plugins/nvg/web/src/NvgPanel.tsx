// The NVG panel (brief, section 4; N1): Import NVG… into a layer of the current workspace, Export
// NVG… of chosen layers, and for admins the web service links with "Get capabilities" (NV1). Built
// from the SDK's shared components; it must work in every pane, narrow and tall or wide and low.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Download, RefreshCw, Upload } from 'lucide-react';
import {
  Button,
  Checkbox,
  Notice,
  PERMISSIONS,
  Select,
  changeRequests,
  classificationOrder,
  type Layer,
  type PluginContext,
  type WorkspaceInfo,
} from '@emc2/plugin-sdk';
import {
  MAX_FILE_BYTES,
  describe,
  exportLayers,
  finished,
  getCapabilities,
  importState,
  listLinks,
  startImport,
  type CapabilityItem,
  type ImportState,
  type LinkState,
} from './server.ts';

/** How often the panel asks for an import's progress (brief, section 4: every second). */
export const POLL_MS = 1000;

const NEW_LAYER = '__new__';

/** The layers of the workspace shown, top first; a fresh snapshot comes on each switch. */
function useLayers(ctx: PluginContext): readonly Layer[] {
  const [layers, setLayers] = useState<readonly Layer[]>([]);
  useEffect(() => {
    let current = new Map<string, Layer>();
    const publish = () => {
      setLayers([...current.values()].sort((a, b) => b.drawOrder - a.drawOrder || a.name.localeCompare(b.name)));
    };
    return ctx.livePicture.subscribe(
      {
        snapshot(snapshot) {
          current = new Map(snapshot.layers.map((l) => [l.id, l]));
          publish();
        },
        changes(batch) {
          let changed = false;
          for (const e of batch) {
            if (e.entityType !== 'layer') continue;
            changed = true;
            if (e.operation === 'delete' || e.state === null) current.delete(e.entityId);
            else current.set(e.entityId, e.state as Layer);
          }
          if (changed) publish();
        },
      },
      { objects: false },
    );
  }, [ctx]);
  return layers;
}

function useWorkspace(ctx: PluginContext): WorkspaceInfo {
  const [workspace, setWorkspace] = useState(ctx.workspace.current);
  useEffect(() => ctx.workspace.onChange(setWorkspace), [ctx]);
  return workspace;
}

/** A file's name without its extension: a new layer's name (N2). */
export function baseName(file: string): string {
  const dot = file.lastIndexOf('.');
  const base = dot > 0 ? file.slice(0, dot) : file;
  return base.trim() === '' ? file : base;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function NvgPanel(props: { readonly ctx: PluginContext }): ReactNode {
  const { ctx } = props;
  const layers = useLayers(ctx);
  const workspace = useWorkspace(ctx);
  // SDK 1.8.0 part C, "name once": the shell's head shows the title, so no frame repeats it. Each
  // section keeps its own action (Import, Export, Get capabilities), so there is no PanelFoot.
  return (
    <div className="nvg-panel">
      <ImportSection ctx={ctx} layers={layers} workspace={workspace} />
      <ExportSection ctx={ctx} layers={layers} />
      {ctx.user.has(PERMISSIONS.settingsAdmin) ? <LinksSection ctx={ctx} /> : null}
    </div>
  );
}

function ImportSection(props: { readonly ctx: PluginContext; readonly layers: readonly Layer[]; readonly workspace: WorkspaceInfo }): ReactNode {
  const { ctx, layers, workspace } = props;
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState<string>(NEW_LAYER);
  const policy = ctx.defaultLabel.policyIdentifier.name;
  const order = classificationOrder(ctx.classifications, policy);
  const [classification, setClassification] = useState(ctx.defaultLabel.classification);
  const [state, setState] = useState<ImportState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  // A function, so that each check reads the ref anew after an await.
  const mounted = () => alive.current;
  const mayEdit = ctx.user.has(workspace.editPermission ?? PERMISSIONS.objectsEdit);
  const mayMakeLayer = ctx.user.has(workspace.editPermission ?? PERMISSIONS.layersEdit);
  // The picker lists only the layers the user may edit (brief, criterion 12): none without the
  // workspace's edit right, and no locked layer (ADR-0042).
  const editable = mayEdit ? layers.filter((l) => l.locked !== true) : [];
  // A layer that went, got locked, or a workspace switch falls back to a new layer.
  const chosen = editable.find((l) => l.id === target);
  const effectiveTarget = chosen === undefined ? NEW_LAYER : target;
  const why = !mayEdit
    ? `You may not edit the layers of ${workspace.name}`
    : effectiveTarget === NEW_LAYER && !mayMakeLayer
      ? 'You may not make layers here; choose an existing layer'
      : file === null
          ? 'Choose an NVG file first'
          : file.size > MAX_FILE_BYTES
            ? 'The file is larger than 16 MiB'
            : busy
              ? 'An import is running'
              : null;

  // The layer this panel made for the file goes again when the import puts nothing into it (UDA,
  // 2026-11-12): refused (a DTD, another version, not XML), answered 4xx before a job started, or
  // ended with no object created. Imported items that already exist stay in their own layers, so
  // "nothing created" is "nothing in the new layer". A failed delete leaves the layer, as before.
  async function removeMade(layer: Layer) {
    try {
      await ctx.changes.submit(changeRequests.deleteLayer(layer));
    } catch {
      // Outcome unknown: the layer may stay, as it did before this check.
    }
  }

  async function run(selected: File) {
    setBusy(true);
    setError(null);
    setState(null);
    let made: Layer | null = null;
    let current: ImportState | null = null;
    try {
      let layerId = effectiveTarget;
      if (effectiveTarget === NEW_LAYER) {
        const id = ctx.newId();
        const top = layers.reduce((max, l) => Math.max(max, l.drawOrder), 0) + 1;
        const outcome = await ctx.changes.submit(
          changeRequests.createLayer(id, { name: baseName(selected.name), drawOrder: top, visible: true, label: ctx.defaultLabel, workspace: workspace.id }),
        );
        if (outcome.outcome === 'rejected') throw new Error(`The layer could not be made: ${outcome.rejection.message}`);
        made = outcome.event.state as Layer;
        layerId = id;
      }
      const label = order.length > 0 ? { policy, classification } : null;
      current = await startImport(ctx.serverBase, layerId, { name: selected.name, bytes: await selected.arrayBuffer() }, label);
      if (mounted()) setState(current);
      // Followed to its end even when the panel closes, so that an unused new layer is removed.
      while (!finished(current)) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        current = await importState(ctx.serverBase, current.job);
        if (mounted()) setState(current);
      }
      if (made !== null) {
        if ((current.created ?? 0) === 0) await removeMade(made);
        else if (mounted()) setTarget(made.id);
      }
    } catch (e) {
      // Only before a job started: a job that is still running may yet write into the layer.
      if (made !== null && current === null) await removeMade(made);
      if (mounted()) setError(message(e));
    } finally {
      if (mounted()) setBusy(false);
    }
  }

  const options = [
    { value: NEW_LAYER, label: file === null ? 'New layer named after the file' : `New layer: ${baseName(file.name)}`, disabled: !mayMakeLayer },
    ...editable.map((l) => ({ value: l.id, label: l.name })),
  ];
  return (
    <section className="nvg-section" aria-label="Import NVG">
      <h3 className="nvg-heading">Import NVG</h3>
      <input
        ref={input}
        className="nvg-file"
        type="file"
        accept=".nvg,.xml,application/xml,text/xml"
        aria-label="NVG file"
        onChange={(e) => {
          setFile(e.currentTarget.files?.[0] ?? null);
          setState(null);
          setError(null);
        }}
      />
      <div className="nvg-row">
        <Button icon={Upload} onClick={() => input.current?.click()} disabled={!mayEdit} title={mayEdit ? 'Choose an .nvg or .xml file' : (why ?? 'Import is not available')}>
          Choose file…
        </Button>
        <span className="nvg-file-name">{file === null ? 'No file chosen' : file.name}</span>
      </div>
      <Select label="Into layer" value={effectiveTarget} options={options} onChange={setTarget} disabled={!mayEdit || busy} />
      {order.length > 0 ? (
        <Select
          label={`Label of items without one (${policy})`}
          value={classification}
          options={order.map((c) => ({ value: c, label: c }))}
          onChange={setClassification}
          disabled={!mayEdit || busy}
        />
      ) : null}
      <div className="nvg-row">
        <Button
          variant="primary"
          disabled={why !== null}
          title={why ?? 'Import the file into the layer'}
          onClick={() => {
            if (file !== null) void run(file);
          }}
        >
          Import
        </Button>
      </div>
      {!mayEdit ? <Notice>{`You may not edit the layers of ${workspace.name}: import is not available.`}</Notice> : null}
      {state === null ? null : (
        <Notice severity={state.state === 'refused' || state.state === 'failed' ? 'error' : 'info'}>
          {finished(state) ? `${state.name}: ${describe(state)}` : `${state.name}: ${state.state}…`}
        </Notice>
      )}
      {error === null ? null : <Notice severity="error">{error}</Notice>}
    </section>
  );
}

function ExportSection(props: { readonly ctx: PluginContext; readonly layers: readonly Layer[] }): ReactNode {
  const { ctx, layers } = props;
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const picked = layers.filter((l) => chosen.has(l.id));

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const first = picked[0]?.name ?? 'layers';
      const { blob, name } = await exportLayers(ctx.serverBase, picked.map((l) => l.id), first);
      save(blob, name);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="nvg-section" aria-label="Export NVG">
      <h3 className="nvg-heading">Export NVG</h3>
      {layers.length === 0 ? <Notice>No layers in this workspace.</Notice> : null}
      <div className="nvg-layers" role="group" aria-label="Layers to export">
        {layers.map((l) => (
          <Checkbox
            key={l.id}
            label={l.name}
            checked={chosen.has(l.id)}
            onChange={(on) => {
              const next = new Set(chosen);
              if (on) next.add(l.id);
              else next.delete(l.id);
              setChosen(next);
            }}
          />
        ))}
      </div>
      <div className="nvg-row">
        <Button
          icon={Download}
          disabled={picked.length === 0 || busy}
          title={picked.length === 0 ? 'Choose one or more layers first' : busy ? 'An export is running' : 'Save the layers as an .nvg file'}
          onClick={() => void run()}
        >
          Export
        </Button>
      </div>
      {error === null ? null : <Notice severity="error">{error}</Notice>}
    </section>
  );
}

/** Saves a file through the browser (the only way a web part gives the user a file). */
function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

function LinksSection(props: { readonly ctx: PluginContext }): ReactNode {
  const { ctx } = props;
  const [links, setLinks] = useState<readonly LinkState[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<Readonly<Record<string, readonly CapabilityItem[] | string>>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      setLinks(await listLinks(ctx.serverBase));
    } catch (e) {
      setError(message(e));
    }
  }
  useEffect(() => {
    void load();
    // load once when shown; Refresh asks again
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ask(link: string) {
    setBusy(link);
    try {
      const items = await getCapabilities(ctx.serverBase, link);
      setCapabilities((c) => ({ ...c, [link]: items }));
    } catch (e) {
      setCapabilities((c) => ({ ...c, [link]: message(e) }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="nvg-section" aria-label="NVG links">
      <div className="nvg-row nvg-row-spread">
        <h3 className="nvg-heading">Links</h3>
        <Button icon={RefreshCw} onClick={() => void load()}>
          Refresh
        </Button>
      </div>
      {links !== null && links.length === 0 ? <Notice>No links. Add them in the plugin's settings.</Notice> : null}
      {(links ?? []).map((l) => {
        const caps = capabilities[l.name] ?? (l.capabilities !== undefined && l.capabilities.length > 0 ? l.capabilities : undefined);
        return (
          <div key={l.name} className="nvg-link">
            <div className="nvg-link-name">
              {l.name} <span className="nvg-muted">{l.kind}</span>
            </div>
            <div className={l.ok ? 'nvg-muted' : 'nvg-problem'}>{l.enabled ? l.detail : 'switched off'}</div>
            {l.kind === 'soap-provider' && l.path !== undefined ? <div className="nvg-muted nvg-data">{l.path}</div> : null}
            {l.kind === 'soap-consumer' ? (
              <div className="nvg-row">
                <Button disabled={busy !== null} title={busy !== null ? 'A call is running' : "List the provider's filter items"} onClick={() => void ask(l.name)}>
                  Get capabilities
                </Button>
              </div>
            ) : null}
            {typeof caps === 'string' ? <Notice severity="error">{caps}</Notice> : null}
            {Array.isArray(caps) ? (
              <ul className="nvg-capabilities" aria-label={`Filter items of ${l.name}`}>
                {(caps as readonly CapabilityItem[]).map((c) => (
                  <li key={c.id}>
                    <span className="nvg-data">{c.id}</span> {c.name} <span className="nvg-muted">({c.type === '' ? c.kind : `${c.kind}, ${c.type}`})</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
      {error === null ? null : <Notice severity="error">{error}</Notice>}
    </section>
  );
}
