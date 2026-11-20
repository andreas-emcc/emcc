import { describe, expect, it } from 'vitest';
import { pluginEntry } from '../testing/fakes.ts';
import { serverChip, webChip, webText } from './plugin-status.ts';
import { ShellStore } from './store.ts';

/** The row of one active plugin, after `change`. */
function row(change: (store: ShellStore) => void = () => undefined) {
  const store = new ShellStore();
  store.setPlugins([pluginEntry('layer-panel')]);
  store.setLoad('layer-panel', 'active');
  change(store);
  const found = store.getView().plugins.find((p) => p.id === 'layer-panel');
  if (found === undefined) throw new Error('no row');
  return found;
}

describe("a web part's status text", () => {
  it('is OK with nothing reported, and with an OK report without detail', () => {
    expect(webText(row())).toEqual({ text: 'OK', severity: 'ok' });
    expect(webText(row((s) => { s.report('layer-panel', { state: 'OK', detail: '' }); })).text).toBe('OK');
    expect(webText(row((s) => { s.report('layer-panel', { state: 'OK', detail: '  ' }); })).text).toBe('OK'); // spaces are no detail
  });

  it("shows an OK report's detail, as the server's status does (PCA-layer-panel, 2026-10-20)", () => {
    const text = webText(row((s) => { s.report('layer-panel', { state: 'OK', detail: 'object-list not available: double-click opens nothing' }); }));

    expect(text).toEqual({ text: 'OK: object-list not available: double-click opens nothing', severity: 'ok' });
  });

  it('shows the worse of what the plugin reported and what the shell saw', () => {
    const text = webText(row((s) => {
      s.report('layer-panel', { state: 'OK', detail: 'object-list not available' });
      s.observe('layer-panel', { state: 'DEGRADED', detail: 'its theme listener failed' });
    }));

    expect(text).toEqual({ text: 'DEGRADED: its theme listener failed', severity: 'degraded' });
  });
});

describe("the Monitor's chips (T-203)", () => {
  it('shows the server part as a chip: its state, or Disabled, with the detail', () => {
    expect(serverChip(true, 'OK', '')).toEqual({ tone: 'ok', label: 'OK', detail: '' });
    expect(serverChip(true, 'DEGRADED', 'no GPU')).toEqual({ tone: 'warning', label: 'Degraded', detail: 'no GPU' });
    expect(serverChip(true, 'FAILED', 'boom')).toEqual({ tone: 'error', label: 'Failed', detail: 'boom' });
    expect(serverChip(true, 'STARTING', ' ')).toEqual({ tone: 'info', label: 'Starting', detail: '' });
    expect(serverChip(false, 'OK', 'depends on gmti')).toEqual({ tone: 'neutral', label: 'Disabled', detail: 'depends on gmti' });
  });

  it('shows the web part as a chip: loading, not loaded, or its reported state; none without a web part', () => {
    expect(webChip(row())).toEqual({ tone: 'ok', label: 'OK', detail: '' });
    expect(webChip(row((s) => { s.report('layer-panel', { state: 'DEGRADED', detail: 'no layers' }); }))).toEqual({ tone: 'warning', label: 'Degraded', detail: 'no layers' });
    expect(webChip(row((s) => { s.setLoad('layer-panel', 'loading'); }))).toEqual({ tone: 'info', label: 'Loading…', detail: '' });
    expect(webChip(row((s) => { s.setLoad('layer-panel', 'failed', 'no entry module'); }))).toEqual({ tone: 'error', label: 'Not loaded', detail: 'no entry module' });
    expect(webChip(row((s) => { s.setLoad('layer-panel', 'none'); }))).toBeNull();
  });
});
