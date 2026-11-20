// A panel's frame from SDK 1.8.0 (CR-0043 part C; T-204, the UXA's P1 and P5): the shell's head shows
// the panel's title, so the panel shows no inner heading; buttons that sat in that heading go to the top
// of the body, and actions that apply to the whole body go in a `PanelFoot`, last, which the shell pins
// at the panel's bottom. It does not scroll by itself: the shell's panel body does, so the foot stays
// in view. Replaces the SDK's `PanelFrame` in the Simulation workspace's panels.
import type { ReactNode } from 'react';

export function SimPanel(props: {
  /** The panel's title, as its region's name (not shown: the shell's head shows it). */
  readonly label: string;
  /** Buttons at the top of the body, right-aligned, where the old heading had them. */
  readonly actions?: ReactNode;
  /** A `PanelFoot` with the actions that apply to the whole body. */
  readonly foot?: ReactNode;
  readonly children?: ReactNode;
}): ReactNode {
  return (
    <section className="simulator-frame" aria-label={props.label}>
      <div className="simulator-frame-body">
        {props.actions === undefined ? null : <div className="simulator-frame-top">{props.actions}</div>}
        {props.children}
      </div>
      {props.foot ?? null}
    </section>
  );
}
