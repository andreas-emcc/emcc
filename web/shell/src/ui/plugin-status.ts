import type { ChipTone } from '@emc2/plugin-sdk';
import { worse, type PluginRow } from './store.ts';

/** A state's word in sentence case: "DEGRADED" is "Degraded". */
export function stateWord(state: string): string {
  return state === 'OK' ? 'OK' : state.charAt(0) + state.slice(1).toLowerCase();
}

/** The tone of a plugin state's chip (T-203): OK ok, DEGRADED warning, FAILED error, any other info. */
export function stateTone(state: string): ChipTone {
  return state === 'OK' ? 'ok' : state === 'DEGRADED' ? 'warning' : state === 'FAILED' ? 'error' : 'info';
}

/** A state as a chip (its tone and word) and the detail shown after it as text, which may be long. */
export interface StateChip {
  readonly tone: ChipTone;
  readonly label: string;
  readonly detail: string;
}

const chip = (tone: ChipTone, label: string, detail: string): StateChip => ({ tone, label, detail: detail.trim() });

/** The server part as a chip (T-203, the Monitor): its state, or Disabled, and the detail. */
export function serverChip(active: boolean, state: string, detail: string): StateChip {
  if (!active) return chip('neutral', 'Disabled', detail);
  return chip(stateTone(state), stateWord(state), detail);
}

/** The web part in this browser as a chip (T-203, the Monitor), or null when the plugin has none. */
export function webChip(p: PluginRow): StateChip | null {
  switch (p.load) {
    case 'none':
      return null;
    case 'waiting':
    case 'loading':
      return chip('info', 'Loading…', '');
    case 'failed':
    case 'refused':
      return chip('error', 'Not loaded', p.loadDetail);
    case 'active': {
      const status = worse(p.reported, p.observed);
      return status === null ? chip('ok', 'OK', '') : chip(stateTone(status.state), stateWord(status.state), status.detail);
    }
  }
}

/** How a plugin's web part stands in this browser, as the Control Pane and the Monitor tab show it. */
export function webText(p: PluginRow): { readonly text: string | null; readonly severity: 'ok' | 'degraded' | 'failed' } {
  const serverSeverity = !p.server.active || p.server.state === 'FAILED' ? 'failed' : p.server.state === 'DEGRADED' ? 'degraded' : 'ok';
  switch (p.load) {
    case 'none':
      return { text: null, severity: serverSeverity };
    case 'waiting':
    case 'loading':
      return { text: 'loading…', severity: serverSeverity };
    case 'failed':
    case 'refused':
      return { text: `not loaded: ${p.loadDetail}`, severity: 'failed' };
    case 'active': {
      const status = worse(p.reported, p.observed);
      // An OK detail is shown too, as the server's is (e.g. layer-panel: "object-list not available: …").
      if (status === null || status.state === 'OK') {
        return { text: status === null || status.detail.trim() === '' ? 'OK' : `OK: ${status.detail}`, severity: serverSeverity };
      }
      return { text: `${status.state}: ${status.detail}`, severity: status.state === 'FAILED' ? 'failed' : 'degraded' };
    }
  }
}
