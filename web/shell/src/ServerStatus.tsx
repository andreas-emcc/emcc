import { useEffect, useState } from 'react';

/** Response of GET /api/health (server/app HealthController). */
export interface Health {
  status: string;
  ecore: string;
  /** M9 RC2: the release's version.properties; `{ name: 'dev', sdk }` on a developer run. */
  version?: ReleaseVersion;
  /** M9 RC2: whether the release has its user manual at /manual/. */
  manual?: boolean;
}

/** The `version` of GET /api/health (server/app ReleaseInfo); a key the file lacks is absent. */
export interface ReleaseVersion {
  name: string;
  date?: string;
  commit?: string;
  dirty?: boolean;
  sdk?: string;
}

type State = { kind: 'checking' } | { kind: 'ok'; health: Health } | { kind: 'unreachable' };

const TIMEOUT_MS = 5000;

/** Shows whether the emc2 server and ECore are running. */
export function ServerStatus() {
  const [state, setState] = useState<State>({ kind: 'checking' });

  useEffect(() => {
    const unmounted = new AbortController();
    const signal = AbortSignal.any([unmounted.signal, AbortSignal.timeout(TIMEOUT_MS)]);

    fetch('/api/health', { signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${String(response.status)}`);
        }
        const health = (await response.json()) as Health;
        setState({ kind: 'ok', health });
      })
      .catch(() => {
        if (!unmounted.signal.aborted) {
          setState({ kind: 'unreachable' });
        }
      });

    return () => {
      unmounted.abort();
    };
  }, []);

  return (
    <p role="status" aria-label="Server">
      Server: {describe(state)}
    </p>
  );
}

function describe(state: State): string {
  switch (state.kind) {
    case 'checking':
      return 'checking…';
    case 'ok':
      return `${state.health.status} (ECore ${state.health.ecore})`;
    case 'unreachable':
      return 'not reachable';
  }
}
