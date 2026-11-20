// The "Put on route" dialog (brief functions 10 and 22; A28; from M4 A68): over the map's right edge,
// the route, the kind, and a convoy's spacing. Its close button and Escape close it.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { Button, IconButton, Notice, PanelFrame, Select, TextField } from '@emc2/plugin-sdk';
import { FailureNotice } from './FailureNotice.tsx';
import { useModel } from './model.ts';
import type { SimulationPicture } from './picture.ts';
import type { GroupKind, PutOnRouteModel } from './putOnRoute.ts';

const KINDS: readonly { readonly value: GroupKind; readonly label: string }[] = [
  { value: 'single', label: 'Each on its own' },
  { value: 'convoy', label: 'Convoy' },
  { value: 'formation', label: 'Formation' },
];

export function PutOnRoutePanel(props: { readonly model: PutOnRouteModel; readonly picture: SimulationPicture }) {
  const { model, picture } = props;
  const state = useModel(model);
  const box = useRef<HTMLDivElement>(null);
  // The focus goes into the dialog when it opens, so that Escape and the keyboard reach it.
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('select, input, button:not([disabled])')?.focus();
  }, []);
  useSyncExternalStore(picture.onChange, picture.revision);
  const routes = picture.routes();
  const problem = model.problem();
  const spacingProblem = model.spacingProblem();
  const count = state.objects.length;

  return (
    <div
      ref={box}
      className="simulator-dialog"
      role="dialog"
      aria-label="Put on route"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          model.close();
        }
      }}
    >
    <PanelFrame title="Put on route" actions={<IconButton icon={X} label="Close" onClick={() => { model.close(); }} />}>
      <div className="simulator-panel">
        <p className="simulator-text">{count === 1 ? '1 object chosen.' : `${String(count)} objects chosen.`} An object on another route is taken off it.</p>
        {routes.length === 0 ? (
          <Notice severity="warning">No routes in Simulation yet.</Notice>
        ) : (
          <Select
            label="Route"
            value={state.route ?? ''}
            options={[{ value: '', label: 'Choose a route', disabled: true }, ...routes.map((r) => ({ value: r.object.id, label: r.name }))]}
            onChange={(route) => { model.setRoute(route); }}
          />
        )}
        <Select label="Kind" value={state.kind} options={KINDS} onChange={(kind) => { model.setKind(kind); }} />
        {state.kind === 'convoy' ? (
          <TextField
            label="Spacing (m)"
            value={state.spacing}
            onChange={(spacing) => { model.setSpacing(spacing); }}
            {...(spacingProblem === null ? {} : { error: spacingProblem })}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            data
          />
        ) : null}
        <FailureNotice failure={state.failure} onDismiss={() => { model.dismissFailure(); }} />
        <div className="simulator-actions">
          <Button variant="primary" disabled={problem !== null || state.busy} {...(problem === null ? {} : { title: problem })} onClick={() => void model.submit()}>
            Put on route
          </Button>
          <Button onClick={() => { model.close(); }}>Cancel</Button>
        </div>
      </div>
    </PanelFrame>
    </div>
  );
}
