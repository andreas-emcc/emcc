// The entry module ("web.entry" in plugin.json, built to dist/index.js). The shell imports it and
// calls activate(ctx) once, with a 10 s timeout. Everything it adds appears in Simulation only
// (brief function 22, A15). The map view is required in the manifest, so its provider has
// activated before this runs.
import { CircleOff, Pencil, RadioTower, Route, Zap } from 'lucide-react';
import { definePlugin, MAP_VIEW, SYMBOLS } from '@emc2/plugin-sdk';
import type { SymbolService } from '@emc2/plugin-sdk';
import { RouteColourModel } from './colour.ts';
import { ColoursModel, CoverageModel, CoverageOverlay, PreviewModel } from './coverage.ts';
import { DwellsModel } from './dwells.ts';
import { RouteEditorModel } from './editor.ts';
import { EventModel } from './events.ts';
import { EventPanel } from './EventPanel.tsx';
import { RouteEditorPanel } from './RouteEditorPanel.tsx';
import { HiddenFade } from './fade.ts';
import { OutputsModel } from './outputs.ts';
import { GROUND_TRUTH_TITLE, OutputsPanel } from './OutputsPanel.tsx';
import { EDIT, RUN, VIEW } from './permissions.ts';
import type { Rights } from './permissions.ts';
import { ROUTE_TYPE, SIMULATION, SimulationPicture } from './picture.ts';
import { PutOnRouteModel, takeOffRoute } from './putOnRoute.ts';
import { PutOnRoutePanel } from './PutOnRoutePanel.tsx';
import { RoutesModel } from './routes.ts';
import { RoutesPanel } from './RoutesPanel.tsx';
import { SCENARIO_ITEM, SCENARIO_ORDER, ScenarioMenu } from './ScenarioMenu.tsx';
import { SensorsModel } from './sensors.ts';
import { SENSORS_TITLE, SensorsIcon, SensorsPanel, SensorWarnings } from './SensorsPanel.tsx';
import { SimulatorServer } from './server.ts';
import { UnitsModel } from './unitsModel.ts';
import './simulator.css';

const WORKSPACES = [SIMULATION];

export default definePlugin({
  activate(ctx) {
    // Without the workspace's view permission the tab is hidden and the server refuses every read
    // (brief function 1; Q15), so nothing is added: no panel can read, even where a shell mounts
    // Simulation's panels elsewhere (the ITA's finding 3).
    if (!ctx.user.has(VIEW)) {
      ctx.status.set('OK', `no ${VIEW}: nothing to show`);
      return;
    }
    const rights: Rights = { edit: ctx.user.has(EDIT), run: ctx.user.has(RUN) };
    const server = new SimulatorServer(ctx.serverBase);
    const picture = new SimulationPicture(ctx.livePicture);
    const units = new UnitsModel(ctx);
    const routes = new RoutesModel(server, picture, ctx.changes);
    const outputs = new OutputsModel(server);
    const sensors = new SensorsModel(server);
    // "Show coverage" (function 33, Q28 A): per user, read once.
    const coverage = new CoverageModel(ctx.userDocuments, ctx.log);
    void coverage.load();
    // Function 46: the admin's colours, applied at once in every browser; function 45's live preview; function 43's dwells.
    const colours = new ColoursModel(ctx.settings, (listener) => ctx.onSettingsChange(listener));
    const preview = new PreviewModel();
    const dwells = new DwellsModel(server);
    const declaredFields = ctx.declaredFields;
    const fieldSets = ctx.fieldSets;
    let symbols: SymbolService | null = null;

    // The route editor and the Event panel exist while they are open (as draw-shapes' edit panel).
    const colour = new RouteColourModel(picture, ctx.changes);
    const editor: RouteEditorModel = new RouteEditorModel(ctx, server, picture, units, () =>
      ctx.ui.addPanel({
        id: 'route-editor',
        title: 'Route editor',
        icon: Pencil,
        defaultPane: 'right',
        order: 80,
        workspaces: WORKSPACES,
        component: () => <RouteEditorPanel model={editor} events={events} picture={picture} units={units} declaredFields={declaredFields} rights={rights} />,
      }),
      colour.colour,
    );
    // The Event panel belongs to the route open in the editor: it closes with it (the review of C2).
    editor.subscribe(() => {
      const event = events.getState();
      if (event.open && event.routeId !== editor.getState().routeId) events.close();
    });
    const events: EventModel = new EventModel(editor, () =>
      ctx.ui.addPanel({
        id: 'event',
        title: 'Event',
        icon: Zap,
        defaultPane: 'right',
        order: 85,
        workspaces: WORKSPACES,
        component: () => <EventPanel model={events} editor={editor} picture={picture} declaredFields={declaredFields} fieldSets={fieldSets} dataTypes={() => ctx.dataTypes} symbols={() => symbols} rights={rights} />,
      }),
    );

    ctx.ui.addPanel({
      id: 'routes',
      title: 'Routes',
      icon: Route,
      // Default panes (from M4, BS; A70): Routes left, after Symbols and Shapes; the others right.
      defaultPane: 'left',
      order: 300,
      workspaces: WORKSPACES,
      component: () => <RoutesPanel model={routes} editor={editor} colour={colour} picture={picture} units={units} rights={rights} />,
    });
    // The Scenario button (function 48, T-152; SDK 1.6.0 part F): in Simulation's top bar only; it
    // replaces function 32's two buttons in the Routes panel.
    ctx.ui.addTopBarItem({
      id: SCENARIO_ITEM,
      order: SCENARIO_ORDER,
      workspaces: WORKSPACES,
      component: () => <ScenarioMenu server={server} picture={picture} changes={ctx.changes} routes={routes} rights={rights} />,
    });
    ctx.ui.addPanel({
      id: 'outputs',
      title: GROUND_TRUTH_TITLE,
      icon: RadioTower,
      defaultPane: 'right',
      order: 110,
      workspaces: WORKSPACES,
      component: () => <OutputsPanel model={outputs} declaredFields={declaredFields} fieldSets={fieldSets} rights={rights} />,
    });

    // The Sensors panel and its warning over the map (functions 27 to 29; A105, A106).
    ctx.ui.addPanel({
      id: 'sensors',
      title: SENSORS_TITLE,
      icon: SensorsIcon,
      defaultPane: 'right',
      order: 120,
      workspaces: WORKSPACES,
      component: () => <SensorsPanel model={sensors} coverage={coverage} picture={picture} units={units} fieldSets={fieldSets} rights={rights} colours={colours} preview={preview} />,
    });
    ctx.ui.addMapPaneOverlay({
      id: 'sensor-warnings',
      position: 'bottom-left',
      order: 100,
      workspaces: WORKSPACES,
      component: () => <SensorWarnings model={sensors} />,
    });

    // "Put on route" and "Take off route" (brief function 10; A28, A29): the shell offers them only
    // in Simulation and to users with plugin.simulator.edit; the server checks the commands anyway.
    const put: PutOnRouteModel = new PutOnRouteModel(server, picture, () =>
      ctx.ui.addMapPaneOverlay({
        id: 'put-on-route',
        // After the corner's icons (map-view-2d's controls are order 10), at the map's right edge (A68).
        position: 'top-right',
        order: 200,
        workspaces: WORKSPACES,
        component: () => <PutOnRoutePanel model={put} picture={picture} />,
      }),
    );
    ctx.actions.addObjectAction({
      id: 'put-on-route',
      label: 'Put on route',
      icon: Route,
      group: 'simulator',
      order: 10,
      appliesTo: { types: ['core.symbol'], test: (o) => picture.isTrack(o) },
      multiple: true,
      permission: EDIT,
      workspaces: WORKSPACES,
      run: (ids) => {
        put.open(ids);
      },
    });
    // "Edit route" (A35): opens the route editor; read-only users see the route's values.
    ctx.actions.addObjectAction({
      id: 'edit-route',
      label: 'Edit route',
      icon: Pencil,
      group: 'edit',
      appliesTo: { types: ['core.shape'], dataTypes: [ROUTE_TYPE], test: (o) => picture.isSimulationLayer(o.layerId) },
      multiple: false,
      workspaces: WORKSPACES,
      run: ([id]) => {
        if (id !== undefined) editor.open(id);
      },
    });
    ctx.actions.addObjectAction({
      id: 'take-off-route',
      label: 'Take off route',
      icon: CircleOff,
      group: 'simulator',
      order: 20,
      appliesTo: { types: ['core.symbol'], test: (o) => picture.isTrack(o) && picture.routeOf(o.id) !== null },
      multiple: true,
      permission: EDIT,
      workspaces: WORKSPACES,
      run: (ids) => takeOffRoute(server, ids, (n) => {
        ctx.notify(n);
      }),
    });

    ctx.status.set('OK', 'ready');

    // Only the fade list needs the map view, so the panels and actions above work without it,
    // and activate does not wait for it (the review of C1).
    ctx.services.get(MAP_VIEW).then(
      (map) => {
        editor.setMap(map);
        sensors.setMap(map);
        new HiddenFade(map, picture, ctx.workspace);
        new CoverageOverlay(map, picture, sensors, coverage, ctx.workspace, colours, preview, dwells);
      },
      (e: unknown) => {
        ctx.log.warn('no map view, so hidden tracks are not faded and no coverage is drawn', e);
        ctx.status.set('DEGRADED', 'no map view: hidden tracks are not faded, no coverage is drawn, and routes cannot be drawn');
      },
    );
    // The symbol service checks an event's SIDC (A44) when it is there ("uses").
    ctx.services.get(SYMBOLS).then(
      (service) => {
        symbols = service;
      },
      () => {
        ctx.log.info("no symbol service: an event's SIDC is checked by its length only");
      },
    );
  },
});
