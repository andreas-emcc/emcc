import { Button, Notice } from '@emc2/plugin-sdk';
import { useSyncExternalStore } from 'react';
import { softwareNotice, type RenderingNotice } from '../core/rendering.ts';

/**
 * A Map Pane overlay: the notice that the map is drawn without a GPU (brief function 9, criterion
 * 13). The user can dismiss it. The SDK's `Notice` and `Button` (brief function 21).
 */
export function RenderingNoticeView(props: { readonly notice: RenderingNotice; readonly budget: number }) {
  const { notice, budget } = props;
  // Re-render when the notice changes; the notice holds the state.
  useSyncExternalStore((onChange) => notice.onChange(onChange), () => notice.visible);
  if (!notice.visible) return null;
  return (
    <div className="map-view-2d-notice">
      <Notice severity="warning">
        <p>{softwareNotice(budget)}</p>
        <Button
          onClick={() => {
            notice.dismiss();
          }}
        >
          Dismiss
        </Button>
      </Notice>
    </div>
  );
}
