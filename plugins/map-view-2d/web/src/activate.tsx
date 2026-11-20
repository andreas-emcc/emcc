/**
 * What `activate` does, with its browser dependencies passed in so tests can replace them: read
 * the settings, register the projections, check the rendering, create the engine and the
 * controller, provide `MapView`, take the Map Pane, subscribe to the live picture, and use the
 * symbology and background map services when they come.
 */
import { BACKGROUND_MAP, EVERY_WORKSPACE, MAP_VIEW, SYMBOLS, type LivePictureOptions, type MapView, type PluginContext } from '@emc2/plugin-sdk';
import { Crosshair, LocateFixed, ZoomIn } from 'lucide-react';
import type { ChoiceStore } from './core/background.ts';
import type { Clock } from './core/cadence.ts';
import { initialView, MapController } from './core/controller.ts';
import type { Engine } from './core/engine.ts';
import { textLookFrom } from './core/look.ts';
import { registerProjections, type Projection } from './core/projections.ts';
import { checkRendering, type ProbeCanvas, type RenderingCheck } from './core/rendering.ts';
import { DEFAULT_SETTINGS, objectBudget, readSettings, type MapSettings } from './core/settings.ts';
import { mapStatus, type StatusInput } from './core/status.ts';
import { NullEngine } from './engine/nullEngine.ts';
import { MapControls } from './ui/MapControls.tsx';
import { memoryControlsOpen, type ControlsOpenStore } from './ui/controlsOpen.ts';
import { RenderingNoticeView } from './ui/RenderingNoticeView.tsx';

/**
 * The shell's event of the map view's moment in a workspace switch, on the element it gave
 * `MapViewMount.mount`; its `detail.workspace` is the workspace switched to. An agreement between
 * the shell and the map view (web/README.md, T-080; owner, 2026-10-27), not an SDK member.
 */
export const SWITCH_EVENT = 'emc2:workspace-switch';

/** An engine that can be shown in the Map Pane. */
export type MountableEngine = Engine & { mount(element: HTMLElement): () => void };

export interface EngineRequest {
  readonly projections: readonly Projection[];
  readonly projection: Projection;
  readonly center: readonly [number, number];
  readonly resolution: number;
  readonly symbolSize: number;
  readonly textThreshold: number;
}

export interface Dependencies {
  /** A fresh canvas for each rendering probe. */
  readonly createCanvas: () => ProbeCanvas;
  /** The drawing engine (OpenLayers in the browser); only called when WebGL is there. */
  readonly createEngine: (request: EngineRequest, ctx: PluginContext) => MountableEngine;
  readonly clock: Clock;
  /** The page's origin, e.g. `http://127.0.0.1:8080`. */
  readonly origin: string;
  /** Where the background choices are kept per browser (brief function 3). */
  readonly choices?: ChoiceStore;
  /** Whether the Map Pane controls are open, kept per browser (owner, 2026-10-21); in memory, collapsed, without it. */
  readonly controlsOpen?: ControlsOpenStore;
}

export interface Activated {
  readonly controller: MapController;
  readonly engine: MountableEngine;
  readonly rendering: RenderingCheck;
}

/** The settings read and checked, with the projections registered from them; problems are logged. */
function readAll(raw: PluginContext['settings'], log: PluginContext['log']): { settings: MapSettings; projections: readonly Projection[]; problems: number } {
  const { settings, problems: settingProblems } = readSettings(raw);
  let registration = registerProjections(settings.projections);
  const problems = [...settingProblems, ...registration.problems];
  if (registration.projections.length === 0) {
    problems.push('no configured projection is usable; using the defaults');
    registration = registerProjections(DEFAULT_SETTINGS.projections);
  }
  for (const problem of problems) log.warn(problem);
  return { settings, projections: registration.projections, problems: problems.length };
}

/**
 * The map view's own actions in the shell's lists (brief function 16, ADR-0032 point 6): Centre map
 * on empty map; Centre on and Zoom to for any objects, through the `MapView` methods. They change
 * nothing, so each is registered once, for every workspace (rules 1 and 4).
 */
function registerActions(ctx: PluginContext, map: MapView): void {
  ctx.actions.addMapAction({
    id: 'centre-map', label: 'Centre map', icon: LocateFixed, group: 'view', workspaces: [EVERY_WORKSPACE],
    run: (position) => {
      map.goTo(position);
    },
  });
  ctx.actions.addObjectAction({
    id: 'centre-on', label: 'Centre on object(s)', icon: Crosshair, group: 'view', order: 10, appliesTo: {}, multiple: true, workspaces: [EVERY_WORKSPACE],
    run: async (ids) => {
      await map.centreOn(ids);
    },
  });
  ctx.actions.addObjectAction({
    id: 'zoom-to', label: 'Zoom to object(s)', icon: ZoomIn, group: 'view', order: 20, appliesTo: {}, multiple: true, workspaces: [EVERY_WORKSPACE],
    run: async (ids) => {
      await map.zoomTo(ids);
    },
  });
}

export function activateMapView(ctx: PluginContext, deps: Dependencies): Activated {
  const { settings, projections, problems } = readAll(ctx.settings, ctx.log);

  const rendering = checkRendering(deps.createCanvas);
  ctx.log.info(`rendering: ${rendering.mode}${rendering.renderer === null ? '' : ` (${rendering.renderer})`}`);

  const start = initialView(settings, projections);
  if (start === null) throw new Error('no usable projection');
  const engine: MountableEngine = rendering.mode === 'none'
    ? new NullEngine(start.projection)
    : deps.createEngine({ ...start, projections, symbolSize: ctx.display.value.symbolSize, textThreshold: settings.textThreshold }, ctx);

  // Only the area in view, with the budget of the rendering mode; above it, clusters (brief function
  // 12). It names workspaces only while a View layer is on as a reference (brief function 23).
  let budget = objectBudget(settings, rendering.mode);
  let unsubscribe: () => void = () => undefined;
  const subscribe = () => {
    unsubscribe();
    const workspaces = controller.subscriptionWorkspaces;
    const options: LivePictureOptions = { area: 'viewport', budget, ...(workspaces === null ? {} : { workspaces }) };
    controller.subscribed(workspaces);
    unsubscribe = ctx.livePicture.subscribe(controller.listener, options);
  };

  const controller = new MapController({
    engine, settings, projections, rendering, clock: deps.clock, origin: deps.origin, log: ctx.log, dataTypes: ctx.dataTypes,
    notify: (notification) => { ctx.notify(notification); },
    objects: ctx.objects,
    openMenu: (at, target) => { ctx.actions.openMenu(at, target); },
    setupChanged: () => { ctx.setup.changed(); },
    workspace: ctx.workspace.current.id,
    display: ctx.display.value,
    relationKinds: ctx.relationKinds,
    relationLines: ctx.relationLines.value,
    subscriptionChanged: () => {
      if (controller.needsSubscription) subscribe();
    },
    ...(deps.choices === undefined ? {} : { choices: deps.choices }),
  });
  ctx.services.provide(MAP_VIEW, controller.service);
  registerActions(ctx, controller.service);
  // The user's display settings (size, labels, speed vector, relation switches) change without reload (brief function 35).
  ctx.display.onChange((display) => {
    controller.setDisplay(display);
  });
  // A relation kind's colour comes from a plugin's settings and changes without reload (brief function 43).
  ctx.relationLines.onChange((lines) => {
    controller.setRelationLines(lines);
  });
  // A data type's behaviour (fading) changes without reload (brief function 13).
  ctx.onDataTypesChange((dataTypes) => {
    controller.setDataTypes(dataTypes);
  });
  // The switch's moment comes on the Map Pane's element, on each mount (brief function 22); the
  // rest of the switch from the map view's onChange listener.
  ctx.ui.setMapView({
    mount: (element) => {
      const onSwitch = (event: Event) => {
        const detail: unknown = (event as CustomEvent<unknown>).detail;
        const named = typeof detail === 'object' && detail !== null ? (detail as { readonly workspace?: unknown }).workspace : undefined;
        controller.workspaceMoment(typeof named === 'string' ? named : ctx.workspace.current.id);
      };
      element.addEventListener(SWITCH_EVENT, onSwitch);
      const unmount = engine.mount(element);
      return () => {
        element.removeEventListener(SWITCH_EVENT, onSwitch);
        unmount();
      };
    },
  });
  ctx.workspace.onChange((workspace) => {
    controller.workspaceShown(workspace.id);
  });
  // Labels and cluster counts follow the look, light or dark at once (brief function 21, criterion 43).
  const applyLook = () => {
    engine.setTextLook(textLookFrom(ctx.theme.tokens()));
  };
  applyLook();
  ctx.theme.onChange(applyLook);
  subscribe();

  // Map Pane overlays, top right (the zoom buttons are top left, the cursor position bottom left), in every workspace (rule 1).
  if (rendering.mode !== 'none') {
    const controlsOpen = deps.controlsOpen ?? memoryControlsOpen();
    ctx.ui.addMapPaneOverlay({ id: 'map-view-2d-controls', position: 'top-right', order: 10, workspaces: [EVERY_WORKSPACE], component: () => <MapControls controller={controller} openStore={controlsOpen} /> });
  }
  if (rendering.mode === 'software') {
    ctx.ui.addMapPaneOverlay({
      id: 'map-view-2d-rendering', position: 'top-right', order: 20, workspaces: [EVERY_WORKSPACE], component: () => <RenderingNoticeView notice={controller.notice} budget={controller.currentSettings.softwareBudget} />,
    });
  }

  const backgrounds = ctx.services.getAll(BACKGROUND_MAP);
  controller.setProviders(backgrounds.current);
  backgrounds.onChange((providers) => {
    controller.setProviders(providers);
  });

  let status: StatusInput = { rendering, symbols: 'waiting', problems, softwareBudget: settings.softwareBudget };
  const report = () => {
    const { state, detail } = mapStatus(status);
    ctx.status.set(state, detail);
  };
  report();

  // The map view's share of the user's setup (brief function 20): map type, centre, zoom, dim and
  // the layers' local visibility. A share it cannot read changes nothing and shows in the status.
  ctx.setup.register({
    save: () => controller.saveShare(),
    restore: (share) => {
      const unreadable = !controller.restoreShare(share);
      if (unreadable !== (status.setupUnreadable ?? false)) {
        status = { ...status, setupUnreadable: unreadable };
        report();
      }
    },
  });

  // Settings change without a restart (design pattern section 7). A new budget needs a new subscription.
  ctx.onSettingsChange((raw) => {
    const next = readAll(raw, ctx.log);
    controller.setSettings(next.settings, next.projections);
    const nextBudget = objectBudget(next.settings, rendering.mode);
    if (nextBudget !== budget) {
      budget = nextBudget;
      subscribe();
    }
    status = { ...status, problems: next.problems, softwareBudget: next.settings.softwareBudget };
    report();
  });

  // Not awaited: the shell activates plugins one at a time and symbology may come after this one.
  ctx.services.get(SYMBOLS)
    .then(
      (symbols) => {
        engine.setSymbols(symbols);
        controller.setSymbols(symbols); // tactical graphics (brief function 29)
        status = { ...status, symbols: 'ready' };
        report();
      },
      (error: unknown) => {
        ctx.log.warn('the symbology plugin is not available; symbols are drawn as markers', error);
        status = { ...status, symbols: 'missing' };
        report();
      },
    )
    .catch((error: unknown) => {
      // Using the symbols failed (e.g. the engine could not redraw): say so instead of losing it.
      ctx.log.error('the symbols could not be set up; symbols are drawn as markers', error);
      status = { ...status, symbols: 'failed' };
      report();
    });

  return { controller, engine, rendering };
}
