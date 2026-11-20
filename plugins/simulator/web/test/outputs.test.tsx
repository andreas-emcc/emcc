// The Outputs panel (brief functions 18 and 22): criteria 13 (each channel with its type, delete
// capability and fields) and 14 (a chosen channel that disappears is missing, not dropped).
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EDIT_HINT } from '../src/permissions.ts';
import { activated, panel, VIEW } from './harness.tsx';
import type { Rig } from './harness.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TAK = {
  id: 'cot/tak', plugin: 'cot', name: 'TAK server', outputType: 'cot', canDelete: true,
  fields: [{ plugin: 'cot', name: 'team' }, { plugin: 'cot', name: 'staleSeconds' }], chosen: false,
};
const LOG = { id: 'recorder/file', plugin: 'recorder', name: 'Recorder', outputType: 'log', canDelete: false, fields: [], chosen: false };

async function shown(body: unknown, options: Parameters<typeof activated>[0] = {}): Promise<Rig> {
  const rig = await activated(options);
  rig.server.on('GET', 'outputs', { status: 200, body: body as never });
  const Panel = panel(rig.ctx, 'outputs');
  render(<Panel />);
  await screen.findByRole('list', { name: 'Output channels' });
  return rig;
}

describe('the Outputs panel (function 18)', () => {
  it("lists each channel with its plugin, type, delete capability and fields (criterion 13)", async () => {
    await shown({ channels: [TAK, LOG], chosen: [] });
    const tak = screen.getByRole('listitem', { name: 'TAK server' });
    expect(within(tak).getByText('cot · cot · sends deletes')).toBeDefined();
    expect(within(tak).getByText('Uses cot.team, cot.staleSeconds')).toBeDefined();
    const log = screen.getByRole('listitem', { name: 'Recorder' });
    expect(within(log).getByText('recorder · log · sends no deletes')).toBeDefined();
  });

  it('names the fields by their declarations where a loaded plugin declares them', async () => {
    const { fieldLabel } = await import('../src/OutputsPanel.tsx');
    expect(fieldLabel('cot.team', [{ plugin: 'cot', name: 'team', type: 'text', label: 'Team' }])).toBe('Team (cot)');
    expect(fieldLabel('cot.role', [])).toBe('cot.role');
  });

  it('chooses a channel, keeping the rest of the choice', async () => {
    const { server } = await shown({ channels: [TAK, { ...LOG, chosen: true }], chosen: [{ id: LOG.id, missing: false }] });
    const after = { channels: [{ ...TAK, chosen: true }, { ...LOG, chosen: true }], chosen: [{ id: LOG.id, missing: false }, { id: TAK.id, missing: false }] };
    server.on('POST', 'outputs', () => {
      // The server part keeps the choice, so the next read answers it too.
      server.on('GET', 'outputs', { status: 200, body: after });
      return { status: 200, body: after };
    });
    await act(async () => {
      fireEvent.click(within(screen.getByRole('listitem', { name: 'TAK server' })).getByRole('checkbox'));
      await Promise.resolve();
    });
    expect(server.posts('outputs').map((c) => c.body)).toEqual([{ channels: [LOG.id, TAK.id] }]);
    // A25: read again at once after the command, not only at the next second.
    const post = server.calls.findIndex((c) => c.method === 'POST');
    await vi.waitFor(() => {
      expect(server.calls.slice(post + 1).some((c) => c.method === 'GET' && c.path === 'outputs')).toBe(true);
    });
    await vi.waitFor(() => {
      expect(within(screen.getByRole('listitem', { name: 'TAK server' })).getByRole('checkbox')).toHaveProperty('checked', true);
    });
  });

  it('shows a chosen channel that is not offered as missing, not dropped, and lets the user remove it (criterion 14, N8)', async () => {
    const { server } = await shown({ channels: [LOG], chosen: [{ id: 'cot/tak', missing: true }] });
    const missing = screen.getByRole('listitem', { name: 'cot/tak' });
    expect(within(missing).getByText('Missing')).toBeDefined();
    server.on('POST', 'outputs', { status: 200, body: { channels: [LOG], chosen: [] } });
    await act(async () => {
      fireEvent.click(within(missing).getByRole('button', { name: 'Remove cot/tak' }));
      await Promise.resolve();
    });
    expect(server.posts('outputs').map((c) => c.body)).toEqual([{ channels: [] }]);
  });

  it('marks an offered channel that answered CLOSED as missing', async () => {
    await shown({ channels: [{ ...TAK, chosen: true }], chosen: [{ id: TAK.id, missing: true }] });
    expect(within(screen.getByRole('listitem', { name: 'TAK server' })).getByText('Missing')).toBeDefined();
  });

  it('shows a refused choice', async () => {
    const { server } = await shown({ channels: [TAK], chosen: [] });
    server.on('POST', 'outputs', { status: 404, body: { error: 'no such channel: cot/tak' } });
    fireEvent.click(within(screen.getByRole('listitem', { name: 'TAK server' })).getByRole('checkbox'));
    expect((await screen.findByRole('alert')).textContent).toContain('no such channel: cot/tak');
  });

  it('offers Retry for a 504, which may have been done (A33)', async () => {
    const { server } = await shown({ channels: [TAK], chosen: [] });
    server.on('POST', 'outputs', { status: 504 });
    fireEvent.click(within(screen.getByRole('listitem', { name: 'TAK server' })).getByRole('checkbox'));
    expect((await screen.findByRole('alert')).textContent).toContain('No answer in time; it may have been done');
    server.on('POST', 'outputs', { status: 200, body: { channels: [{ ...TAK, chosen: true }], chosen: [{ id: TAK.id, missing: false }] } });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => {
      expect(server.posts('outputs')).toHaveLength(2);
    });
    expect(server.posts('outputs').map((c) => c.body)).toEqual([{ channels: [TAK.id] }, { channels: [TAK.id] }]);
  });

  it('says when no plugin offers a channel', async () => {
    const rig = await activated();
    const Panel = panel(rig.ctx, 'outputs');
    render(<Panel />);
    expect(await screen.findByText(/No plugin offers an output channel/)).toBeDefined();
  });

  it('is read-only without plugin.simulator.edit (criterion 22)', async () => {
    await shown({ channels: [TAK], chosen: [{ id: 'cot/old', missing: true }] }, { permissions: [VIEW] });
    expect(screen.getByText(EDIT_HINT)).toBeDefined();
    expect(within(screen.getByRole('listitem', { name: 'TAK server' })).getByRole('checkbox')).toHaveProperty('disabled', true);
    const remove = screen.getByRole('button', { name: 'Remove cot/old' });
    expect(remove).toHaveProperty('disabled', true);
    expect(remove.getAttribute('title')).toBe(EDIT_HINT);
  });
});
