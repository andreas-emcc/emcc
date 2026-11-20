/**
 * The display settings' controls (ADR-0052 point 2), for the user's window and the admin's entry:
 * Symbols (the size, the speed vector in the SDK's steps of seconds (T-164), and from SDK 1.8.0 a drop-down per label place
 * with "Direction arrow" after them; CR-0043 part A) and Relations (one check box per loaded
 * relation kind, absent without kinds) and, from SDK 1.6.0 (CR-0041 part D; T-182), Areas (the display classes'
 * switches, "Dwell areas" and "Sensor coverage", on by default) and, from SDK 1.9.0 (CR-0048 section 6), the colour of
 * friendly control measures, black or blue, under Symbols. A slider shows its value at once (`onPreview`) and gives it
 * on its release (`onChange`: the pointer let go, a key let go, or the focus leaving it; owner,
 * 2026-11-07). Everything else gives its value at once.
 */
import {
  Checkbox, DISPLAY_CLASSES, FRIENDLY_GRAPHIC_COLOURS, friendlyGraphicColourOf, LABEL_PLACE_NAMES, LABEL_PLACES, Select, Slider,
  SYMBOL_SIZE_MAX, SYMBOL_SIZE_MIN, TEXT_LABEL_IDS, type DisplaySettings, type FriendlyGraphicColour, type RelationKind, type SelectOption, type TextLabelId,
} from '@emc2/plugin-sdk';
import { useRef } from 'react';
import {
  LABEL_NAMES, secondsText, shownPlaces, SPEED_VECTOR_POSITIONS, speedVectorPosition, withLabelAt, type DisplayChange,
} from './names.ts';

const COLOUR_OPTIONS: readonly SelectOption<FriendlyGraphicColour>[] = FRIENDLY_GRAPHIC_COLOURS.map((c) => ({ value: c.id, label: c.label }));

const stepAt = (position: number) => SPEED_VECTOR_POSITIONS[position] ?? 0;

/** A place's choices: none, then the text labels in the SDK's order (`TEXT_LABEL_IDS`). */
const NONE = 'none';
const PLACE_OPTIONS: readonly SelectOption<TextLabelId | typeof NONE>[] = [
  { value: NONE, label: 'None' }, ...TEXT_LABEL_IDS.map((l) => ({ value: l, label: LABEL_NAMES[l] })),
];

export function DisplayForm(props: {
  /** What the controls show: the resolved settings. */
  readonly shown: DisplaySettings;
  readonly relationKinds: readonly RelationKind[];
  readonly onPreview: (change: DisplayChange) => void;
  readonly onChange: (change: DisplayChange) => void;
  /** Makes the headings' ids unique in the page. */
  readonly idPrefix: string;
  readonly disabled?: boolean;
}) {
  const { shown, onChange, idPrefix } = props;
  const disabled = props.disabled ?? false;
  const places = shownPlaces(shown);
  return (
    <div className="display-form">
      <section className="display-section" aria-labelledby={`${idPrefix}-symbols`}>
        <h3 id={`${idPrefix}-symbols`}>Symbols</h3>
        <ReleasedSlider label="Symbol size" value={shown.symbolSize} min={SYMBOL_SIZE_MIN} max={SYMBOL_SIZE_MAX}
          format={(v) => `${String(v)} px`} change={(v) => ({ symbolSize: v })} onPreview={props.onPreview} onChange={onChange} disabled={disabled} />
        <ReleasedSlider label="Speed vector" value={speedVectorPosition(shown)} min={0} max={SPEED_VECTOR_POSITIONS.length - 1}
          format={(p) => secondsText(stepAt(p))} change={(p) => ({ speedVectorSeconds: stepAt(p) })}
          onPreview={props.onPreview} onChange={onChange} disabled={disabled} />
        <fieldset className="display-labels">
          <legend>Labels</legend>
          {LABEL_PLACES.map((place) => (
            <Select key={place} label={LABEL_PLACE_NAMES[place]} value={places.labelPlaces[place] ?? NONE} options={PLACE_OPTIONS} disabled={disabled}
              onChange={(value) => { onChange(withLabelAt(shown, place, value === NONE ? null : value)); }} />
          ))}
          <Checkbox label="Direction arrow" checked={places.directionArrow} disabled={disabled}
            onChange={(on) => { onChange({ labelPlaces: places.labelPlaces, directionArrow: on }); }} />
        </fieldset>
        <Select label="Friendly control measures" value={friendlyGraphicColourOf(shown)} options={COLOUR_OPTIONS} disabled={disabled}
          onChange={(value) => { onChange({ friendlyGraphicColour: value }); }} />
      </section>
      {props.relationKinds.length > 0 && (
        <section className="display-section" aria-labelledby={`${idPrefix}-relations`}>
          <h3 id={`${idPrefix}-relations`}>Relations</h3>
          {props.relationKinds.map((kind) => (
            <Checkbox key={kind.id} label={kind.label} checked={shown.relations[kind.id] ?? kind.defaultOn} disabled={disabled}
              onChange={(on) => { onChange({ relation: kind.id, on }); }} />
          ))}
        </section>
      )}
      <section className="display-section" aria-labelledby={`${idPrefix}-areas`}>
        <h3 id={`${idPrefix}-areas`}>Areas</h3>
        {DISPLAY_CLASSES.map((c) => (
          <Checkbox key={c.id} label={c.label} checked={shown.classes[c.id]} disabled={disabled}
            onChange={(on) => { onChange({ displayClass: c.id, on }); }} />
        ))}
      </section>
    </div>
  );
}

/**
 * The SDK's slider, its moves shown at once and its value given on release. The input's own events
 * bubble to this element: a pointer or a key let go, or the focus leaving it, gives the last value
 * moved to.
 */
function ReleasedSlider(props: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly format: (value: number) => string;
  readonly disabled: boolean;
  readonly change: (value: number) => DisplayChange;
  readonly onPreview: (change: DisplayChange) => void;
  readonly onChange: (change: DisplayChange) => void;
}) {
  const pending = useRef<number | null>(null);
  const release = () => {
    const value = pending.current;
    if (value === null) return;
    pending.current = null;
    props.onChange(props.change(value));
  };
  const move = (value: number) => {
    pending.current = value;
    props.onPreview(props.change(value));
  };
  return (
    <div className="display-slider" onPointerUp={release} onKeyUp={release} onBlur={release}>
      <Slider label={props.label} value={props.value} min={props.min} max={props.max} format={props.format} onChange={move} disabled={props.disabled} />
    </div>
  );
}
