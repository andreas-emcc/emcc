/**
 * The foot of an editing surface in Settings (T-203 part C; the UXA's "Saving: one rule", findings
 * S1): one Save per surface, pinned to the surface's bottom edge, on the right, with Discard and
 * the count of unsaved changes on the left. The SDK's `PanelFoot`; the shell's CSS keeps it pinned
 * while the page scrolls above it (`.settings-entry .emc2-panel-foot`).
 */
import { Button, PanelFoot } from '@emc2/plugin-sdk';
import type { ReactNode } from 'react';
import { unsavedText } from './entries.ts';

export function SaveFoot(props: {
  /** The changed values (`changedValues`); 0 when nothing is unsaved. */
  readonly count: number;
  readonly busy: boolean;
  /** Save with its own click; without, Save is the form's submit button. */
  readonly onSave?: () => void;
  readonly onDiscard: () => void;
  /** Off for other reasons than "nothing to save", e.g. an input that cannot be read. */
  readonly saveDisabled?: boolean;
  /** Further actions before Discard, e.g. "Use defaults", or a list item's Delete (T-203 part D). */
  readonly extra?: ReactNode;
  /** T-203 part D: the Save button's words, e.g. "Save link"; default "Save". */
  readonly saveLabel?: string;
}): ReactNode {
  const { count, busy, onSave } = props;
  const saveOff = count === 0 || busy || props.saveDisabled === true;
  return (
    <PanelFoot status={busy ? 'Saving…' : count > 0 ? unsavedText(count) : ''}>
      {props.extra}
      <Button disabled={count === 0 || busy} onClick={props.onDiscard}>Discard</Button>
      {onSave === undefined
        ? <Button variant="primary" type="submit" disabled={saveOff}>{props.saveLabel ?? 'Save'}</Button>
        : <Button variant="primary" disabled={saveOff} onClick={onSave}>{props.saveLabel ?? 'Save'}</Button>}
    </PanelFoot>
  );
}
