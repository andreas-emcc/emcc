// The Scenario button in the top bar (brief function 48, T-152; SDK 1.6.0 part F), shown in
// Simulation only: its menu's "Export scenario…" and "Import scenario…" do what function 32's two
// buttons in the Routes panel did (A110, A112), which they replace. The export needs
// `plugin.simulator.view`; the import `plugin.simulator.edit` and `plugin.simulator.run`, and works
// only while the simulation is reset or paused. "As new" asks before it deletes anything.
import { useEffect, useRef, useState } from 'react';
import { Clapperboard, Download, Upload } from 'lucide-react';
import { Button, ConfirmDialog, Menu, Notice, Popover, Select, TextField } from '@emc2/plugin-sdk';
import type { MenuItem } from '@emc2/plugin-sdk';
import { useModel } from './model.ts';
import type { SimulationPicture } from './picture.ts';
import type { Rights } from './permissions.ts';
import type { RoutesModel } from './routes.ts';
import { buildScenario, fileName, importScenario, parseState, readScenario, remap } from './scenario.ts';
import type { Changes, ImportMode, ImportResult, Scenario } from './scenario.ts';
import type { SimulatorServer } from './server.ts';

/** The top-bar item's id and place (function 48): after the bookmarks (order 0). */
export const SCENARIO_ITEM = 'scenario';
export const SCENARIO_ORDER = 20;

export const IMPORT_HINT = 'Importing a scenario needs the rights to change and to run the simulation';
export const RUNNING_HINT = 'Pause or reset the simulation before importing a scenario';
export const IMPORTING = 'Importing the scenario…';

/** "1 layer", "2 layers". */
export function count(n: number, word: string): string {
  return `${String(n)} ${word}${n === 1 ? '' : 's'}`;
}

/** Saves `text` as a file in the browser's downloads. */
export function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function ScenarioMenu(props: {
  readonly server: SimulatorServer;
  readonly picture: SimulationPicture;
  readonly changes: Changes;
  /** Whether the simulation runs: read while the menu is open. */
  readonly routes: RoutesModel;
  readonly rights: Rights;
}) {
  const { server, picture, routes } = props;
  const anchor = useRef<HTMLSpanElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [name, setName] = useState('Scenario');
  const [loaded, setLoaded] = useState<Scenario | null>(null);
  const [mode, setMode] = useState<ImportMode>('new');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const { running } = useModel(routes);
  // The run state is read only while the menu is open, not all the time from the top bar.
  useEffect(() => (open ? routes.watch() : undefined), [open, routes]);
  const mayImport = props.rights.edit && props.rights.run;
  const importReason = !mayImport ? IMPORT_HINT : running ? RUNNING_HINT : null;
  const layers = picture.simulationLayers();
  const objects = picture.simulationObjects();

  /** The focus back on the Scenario button, as the Popover leaves it to the plugin. */
  const close = () => {
    setOpen(false);
    anchor.current?.querySelector('button')?.focus();
  };

  /** A problem or a result shows in the menu, opened again for it. */
  const tell = (text: string | null, done: ImportResult | null) => {
    setProblem(text);
    setResult(done);
    if (text !== null || done !== null) setOpen(true);
  };

  const exportNow = async (): Promise<void> => {
    tell(null, null);
    const answer = await server.get('scenario-state');
    const state = answer.ok ? parseState(answer.body) : null;
    if (state === null) {
      tell(answer.ok ? 'The server answered something the export cannot read' : answer.message, null);
      return;
    }
    const scenario = buildScenario(name.trim() === '' ? 'Scenario' : name.trim(), picture.simulationLayers(), picture.simulationObjects(), state, new Date());
    download(fileName(scenario.name), JSON.stringify(scenario, null, 2));
  };

  const run = async (scenario: Scenario, how: ImportMode): Promise<void> => {
    setBusy(true);
    tell(null, null);
    if (how === 'new') {
      const reset = await server.post('routes/reset', {});
      if (!reset.ok) {
        setBusy(false);
        tell(`The simulation could not be reset: ${reset.message}`, null);
        return;
      }
    }
    const done = await importScenario(props.changes, server, { layers: picture.simulationLayers(), objects: picture.simulationObjects() }, remap(scenario), how);
    setBusy(false);
    tell(null, done);
  };

  const items: MenuItem[] = [
    { id: 'export', label: 'Export scenario…', icon: Download, disabled: busy },
    { id: 'import', label: 'Import scenario…', icon: Upload, disabled: importReason !== null || busy },
  ];

  return (
    <span ref={anchor} className="simulator-scenario">
      <Button icon={Clapperboard} expanded={open} hasPopup="menu" onClick={() => { if (open) close(); else setOpen(true); }}>
        Scenario
      </Button>
      <Popover open={open} label="Scenario" onClose={close}>
        <div className="simulator-scenario-menu">
          <Menu
            label="Scenario"
            items={items}
            onChoose={(id) => {
              setOpen(false);
              if (id === 'export') {
                setExporting(true);
              } else {
                file.current?.click();
              }
            }}
          />
          {importReason === null ? null : <p className="simulator-muted">{importReason}</p>}
          {busy ? <p className="simulator-muted">{IMPORTING}</p> : null}
          {problem === null ? null : <Notice severity="warning">{problem}</Notice>}
          {result === null ? null : (
            <Notice severity={result.refusals.length === 0 && result.stopped === null ? 'info' : 'warning'}>
              <div>Imported: {String(result.created)} layers and objects created{result.deleted > 0 ? `, ${String(result.deleted)} deleted` : ''}.</div>
              {result.stopped === null ? null : <div>{result.stopped}</div>}
              {result.refusals.length === 0 ? null : (
                <ul aria-label="Refused">
                  {result.refusals.map((r, i) => <li key={`${String(i)} ${r}`}>{r}</li>)}
                </ul>
              )}
            </Notice>
          )}
        </div>
      </Popover>
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        aria-label="Scenario file"
        hidden
        onChange={(e) => {
          const chosen = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (chosen === undefined) return;
          void chosen.text().then((text) => {
            const read = readScenario(text);
            if ('error' in read) {
              tell(read.error, null);
            } else {
              tell(null, null);
              setMode('new');
              setLoaded(read.scenario);
            }
          });
        }}
      />
      <ConfirmDialog
        open={exporting}
        title="Export scenario"
        message={<TextField label="Scenario name" value={name} onChange={setName} autoComplete="off" />}
        confirmLabel="Export"
        onCancel={() => { setExporting(false); }}
        onConfirm={() => {
          setExporting(false);
          void exportNow();
        }}
      />
      <ConfirmDialog
        open={loaded !== null && !confirming}
        title={`Import ${loaded?.name ?? 'scenario'}`}
        message={
          <>
            <p>{`${count(loaded?.layers.length ?? 0, 'layer')} and ${count(loaded?.objects.length ?? 0, 'object')}.`}</p>
            <Select
              label="Import"
              value={mode}
              options={[{ value: 'new', label: 'As new' }, { value: 'merge', label: 'Merge' }]}
              onChange={setMode}
            />
          </>
        }
        confirmLabel="Import"
        onCancel={() => { setLoaded(null); }}
        onConfirm={() => {
          if (loaded === null) return;
          if (mode === 'new') {
            setConfirming(true);
          } else {
            setLoaded(null);
            void run(loaded, 'merge');
          }
        }}
      />
      <ConfirmDialog
        open={loaded !== null && confirming}
        title="Import as new"
        message={`Delete ${count(layers.length, 'layer')} and ${count(objects.length, 'object')} of Simulation?`}
        confirmLabel="Delete and import"
        danger
        onCancel={() => {
          setConfirming(false);
          setLoaded(null);
        }}
        onConfirm={() => {
          const scenario = loaded;
          setConfirming(false);
          setLoaded(null);
          if (scenario !== null) void run(scenario, 'new');
        }}
      />
    </span>
  );
}
