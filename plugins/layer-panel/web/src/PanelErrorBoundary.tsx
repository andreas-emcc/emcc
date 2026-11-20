import { Component, type ReactNode } from 'react';
import { Button } from '@emc2/plugin-sdk';
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
    this.props.log.error('layer panel: rendering failed', error);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <div className="layer-panel" role="alert">
        <p className="layer-panel-hint">The layer panel failed: {error.message}</p>
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
