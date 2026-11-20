import { Component, type ReactNode } from 'react';
import { Button, Notice } from '@emc2/plugin-sdk';
import type { PluginLog } from '@emc2/plugin-sdk';

interface Props {
  readonly log: PluginLog;
  readonly children: ReactNode;
}

/** Keeps a rendering error inside the panel: shows it, logs it, and lets the user try again. */
export class PanelErrorBoundary extends Component<Props, { readonly error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: unknown): { error: Error } {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown): void {
    this.props.log.error('object list: rendering failed', error);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <div className="object-list">
        <Notice severity="error">The object list failed: {error.message}</Notice>
        <Button
          onClick={() => {
            this.setState({ error: null });
          }}
        >
          Try again
        </Button>
      </div>
    );
  }
}
