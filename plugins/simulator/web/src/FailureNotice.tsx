import { Button, Notice } from '@emc2/plugin-sdk';
import type { Failure } from './model.ts';

/** A failed command or change, with Retry where one may help and a way to dismiss it (A33). */
export function FailureNotice(props: { readonly failure: Failure | null; readonly onDismiss: () => void }) {
  const failure = props.failure;
  if (failure === null) return null;
  return (
    <Notice severity="error">
      <span className="simulator-notice-row">
        <span>{failure.message}</span>
        {failure.retry === null ? null : <Button onClick={failure.retry}>Retry</Button>}
        <Button onClick={props.onDismiss}>Dismiss</Button>
      </span>
    </Notice>
  );
}
