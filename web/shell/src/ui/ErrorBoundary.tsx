import { Component, type ReactNode } from 'react';

interface Props {
  /** What failed, for the message, e.g. the panel's title. */
  readonly name: string;
  readonly onError: (error: Error) => void;
  readonly children: ReactNode;
}

interface State {
  readonly error: Error | null;
}

/**
 * Keeps a failing plugin component from taking the shell down (CDA review B3): the component is
 * replaced by a short message and the failure is reported; everything else keeps working.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error): void {
    this.props.onError(error);
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <p role="alert" className="plugin-error">
          {this.props.name} failed: {this.state.error.message}
        </p>
      );
    }
    return this.props.children;
  }
}
