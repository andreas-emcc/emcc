/**
 * The plugin status (design pattern section 8, brief function 9: the rendering result is reported
 * through the plugin status, which the monitor view shows).
 */
import type { PluginStatus } from '@emc2/plugin-sdk';
import type { RenderingCheck } from './rendering.ts';

export interface StatusInput {
  readonly rendering: RenderingCheck;
  /** The symbology plugin's service: still coming, there, not available, or failed when used. */
  readonly symbols: 'waiting' | 'ready' | 'missing' | 'failed';
  /** Settings or projections that could not be used. */
  readonly problems: number;
  readonly softwareBudget: number;
  /** The last setup share restored could not be read (brief function 20). */
  readonly setupUnreadable?: boolean;
}

export function mapStatus({ rendering, symbols, problems, softwareBudget, setupUnreadable }: StatusInput): PluginStatus {
  const renderer = rendering.renderer === null ? '' : ` (${rendering.renderer})`;
  if (rendering.mode === 'none') return { state: 'FAILED', detail: 'WebGL is not available: the map cannot be drawn' };
  const details: string[] = [];
  let degraded = false;
  if (rendering.mode === 'software') {
    degraded = true;
    details.push(`drawn without a GPU${renderer}: up to about ${String(softwareBudget)} objects one by one, clusters beyond`);
  } else {
    details.push(`drawn with a GPU${renderer}`);
  }
  if (symbols === 'missing') {
    degraded = true;
    details.push('symbology is not available: symbols are drawn as markers');
  } else if (symbols === 'failed') {
    degraded = true;
    details.push('the symbols could not be set up: symbols are drawn as markers (see the log)');
  }
  if (setupUnreadable === true) {
    degraded = true;
    details.push('the saved setup could not be read: the map kept its state (see the log)');
  }
  if (problems > 0) {
    degraded = true;
    details.push(`${String(problems)} setting${problems === 1 ? ' is' : 's are'} not usable (see the log)`);
  }
  return { state: degraded ? 'DEGRADED' : 'OK', detail: details.join('; ') };
}
