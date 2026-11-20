// The style fields, used by the Shapes panel (the style of new shapes) and the edit panel. Every
// field commits at once, except the colours: they are typed or picked, and commit when the field
// loses focus, on Enter, or when the picker closes (brief, function 5), so one pick sends one change. A field the user is
// editing keeps the user's value while the shape changes elsewhere (brief, function 7).
import { useState } from 'react';
import { Checkbox, ColorField, Select } from '@emc2/plugin-sdk';
import type { SelectOption } from '@emc2/plugin-sdk';
import { DASH_LABELS, DASHES, FILL_LABELS, FILLS } from './style.ts';
import type { Dash, Fill, StyleChoice } from './style.ts';

/** What a form commits: some fields. A `false` result (the change was refused) keeps the user's input. */
export type StyleCommit = (patch: Partial<StyleChoice>) => Promise<boolean>;

/** Which line options the form offers: an arrow's arrowhead, a route's markers, both for a line of another plugin, or none. */
export type LineOptions = 'none' | 'arrowhead' | 'markers' | 'both';

const WIDTHS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20];
const OPACITIES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

function withCurrent(values: readonly number[], current: number): number[] {
  return values.includes(current) ? [...values] : [...values, current].sort((a, b) => a - b);
}

/** Runs `after` when a commit was not refused. */
function settled(result: Promise<boolean>, after: () => void): void {
  void result.then((ok) => {
    if (ok) after();
  });
}

/**
 * The SDK's colour field with a draft: the user's colour shows until it is committed (Enter, leaving
 * the field, or the picker closing) and stays if the change was refused (brief, functions 5 and 8).
 */
function ColourInput(props: {
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly onCommit: (colour: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    if (draft.toLowerCase() === props.value.toLowerCase()) {
      setDraft(null);
      return;
    }
    settled(props.onCommit(draft), () => {
      setDraft(null);
    });
  };
  return <ColorField label={props.label} value={draft ?? props.value} disabled={props.disabled} onChange={setDraft} onCommit={commit} />;
}

export function StyleForm(props: {
  readonly value: StyleChoice;
  /** The geometry has an area, so a fill applies. */
  readonly area: boolean;
  readonly lines: LineOptions;
  readonly disabled: boolean;
  readonly onChange: StyleCommit;
}) {
  const { value, disabled } = props;
  const widthOptions: SelectOption<string>[] = withCurrent(WIDTHS, value.outlineWidth).map((w) => ({ value: String(w), label: `${String(w)} px` }));
  const dashOptions: SelectOption<Dash>[] = DASHES.map((d) => ({ value: d, label: DASH_LABELS[d] }));
  const fillOptions: SelectOption<Fill>[] = FILLS.map((f) => ({ value: f, label: FILL_LABELS[f] }));
  const percent = Math.round(value.fillOpacity * 100);
  const opacityOptions: SelectOption<string>[] = withCurrent(OPACITIES, percent).map((p) => ({ value: String(p), label: `${String(p)} %` }));
  const change = (patch: Partial<StyleChoice>) => {
    void props.onChange(patch);
  };
  return (
    <div className="draw-shapes-style">
      <ColourInput label="Outline colour" value={value.outlineColor} disabled={disabled} onCommit={(outlineColor) => props.onChange({ outlineColor })} />
      <div className="draw-shapes-row">
        <Select label="Outline width" value={String(value.outlineWidth)} options={widthOptions} disabled={disabled} onChange={(w) => { change({ outlineWidth: Number(w) }); }} />
        <Select label="Outline dash" value={value.outlineDash} options={dashOptions} disabled={disabled} onChange={(outlineDash) => { change({ outlineDash }); }} />
      </div>
      {props.area && (
        <>
          <Select label="Fill" value={value.fill} options={fillOptions} disabled={disabled} onChange={(fill) => { change({ fill }); }} />
          {value.fill !== 'none' && (
            <div className="draw-shapes-row">
              <ColourInput label="Fill colour" value={value.fillColor} disabled={disabled} onCommit={(fillColor) => props.onChange({ fillColor })} />
              <Select label="Fill opacity" value={String(percent)} options={opacityOptions} disabled={disabled} onChange={(p) => { change({ fillOpacity: Number(p) / 100 }); }} />
            </div>
          )}
        </>
      )}
      {(props.lines === 'arrowhead' || props.lines === 'both') && (
        <Checkbox label="Arrowhead at the last point" checked={value.arrowhead} disabled={disabled} onChange={(arrowhead) => { change({ arrowhead }); }} />
      )}
      {(props.lines === 'markers' || props.lines === 'both') && (
        <Checkbox label="Markers at the points" checked={value.markers} disabled={disabled} onChange={(markers) => { change({ markers }); }} />
      )}
    </div>
  );
}
