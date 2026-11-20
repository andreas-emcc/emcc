// The Shapes panel (brief, function 1): a tool for each kind of shape, the style and the name for
// new shapes, and the data type. It works in every pane: content wraps, nothing has a fixed size.
import { Circle, Ellipse, MoveUpRight, Pentagon, RectangleHorizontal, Route, Square } from 'lucide-react';
import { choosableDataTypes, IconButton, Notice, Select, TextField } from '@emc2/plugin-sdk';
import type { IconComponent } from '@emc2/plugin-sdk';
import type { ShapesController } from './controller.ts';
import { hasArea, KIND_LABELS, SHAPE_KINDS, withArticle } from './kinds.ts';
import type { ShapeKind } from './kinds.ts';
import { StyleForm } from './StyleForm.tsx';
import { useShapesState } from './useShapesState.ts';

const TOOL_ICONS: Readonly<Record<ShapeKind, IconComponent>> = {
  circle: Circle,
  ellipse: Ellipse,
  square: Square,
  rectangle: RectangleHorizontal,
  polygon: Pentagon,
  arrow: MoveUpRight,
  route: Route,
};

/** How the user draws a kind: by pressing and dragging, or point by point. */
export function drawingHint(kind: ShapeKind): string {
  const name = KIND_LABELS[kind].toLowerCase();
  return kind === 'arrow' || kind === 'route' || kind === 'polygon'
    ? `Drawing ${withArticle(name)}: click each point on the map; double-click or Enter finishes, Escape cancels.`
    : `Drawing ${withArticle(name)}: press and drag on the map. Escape cancels.`;
}

export function ShapesPanel(props: { readonly controller: ShapesController }) {
  const { controller } = props;
  const state = useShapesState(controller);
  // The panel's name is the shell's head (SDK 1.8.0, "name once"): no heading of its own here.
  return (
    <div className="draw-shapes-content">
      {state.hint !== null && <Notice severity="warning">{state.hint}</Notice>}
      <div className="draw-shapes-tools" role="group" aria-label="Shape tools">
        {SHAPE_KINDS.map((kind) => (
          <IconButton
            key={kind}
            icon={TOOL_ICONS[kind]}
            label={KIND_LABELS[kind]}
            pressed={state.tool === kind}
            disabled={!state.canDraw && state.tool !== kind}
            {...(state.lockedTitle === null ? {} : { title: state.lockedTitle })}
            onClick={() => {
              controller.setTool(kind);
            }}
          />
        ))}
      </div>
      {state.tool !== null && <p className="draw-shapes-hint">{drawingHint(state.tool)}</p>}
      <TextField
        label="Name"
        value={state.name}
        placeholder="Shown as the label"
        disabled={state.readOnly}
        onChange={(name) => {
          controller.setName(name);
        }}
      />
      <StyleForm
        value={state.style}
        area={state.tool === null || hasArea(state.tool)}
        lines="none"
        disabled={state.readOnly}
        onChange={(patch) => {
          controller.setStyle(patch);
          return Promise.resolve(true);
        }}
      />
      <Select
        label="Data type"
        value={state.dataType}
        options={choosableDataTypes(state.dataTypes).map((t) => ({ value: t.id, label: t.name }))}
        disabled={state.readOnly}
        onChange={(id) => {
          controller.setDataType(id);
        }}
      />
    </div>
  );
}
