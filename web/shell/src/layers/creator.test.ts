import type { ChangeOutcome, ChangeRequestContent, LivePictureListener, SecurityLabel, Snapshot, User } from '@emc2/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import { LayerCreator } from './creator.ts';
import { KnownLayers } from './known.ts';

const LABEL: SecurityLabel = { policyIdentifier: { name: 'NATO' }, classification: 'RESTRICTED' };

function creator(options: { readonly permissions?: readonly string[]; readonly label?: SecurityLabel | null; readonly layers?: readonly object[] } = {}) {
  const channel: { listener: LivePictureListener | null } = { listener: null };
  const known = new KnownLayers(() => ({ subscribe: (l) => { channel.listener = l; return () => undefined; } }));
  known.ready().catch(() => undefined);
  channel.listener?.snapshot({ layers: options.layers ?? [], objectCounts: {} } as unknown as Snapshot);
  const sent: ChangeRequestContent[] = [];
  const connection = { submit: vi.fn((content: ChangeRequestContent) => { sent.push(content); return Promise.resolve({ outcome: 'applied' } as unknown as ChangeOutcome); }) };
  const user = { has: (p: string) => (options.permissions ?? ['layers.edit']).includes(p) } as unknown as User;
  return { creator: new LayerCreator({ user: () => user, layers: known, label: () => (options.label === undefined ? LABEL : options.label), connection }), sent };
}

describe('the layer pickers\' "+" (SDK 1.4.0, T-133)', () => {
  it('needs layers.edit', () => {
    expect(creator().creator.allowed).toBe(true);
    expect(creator({ permissions: ['objects.edit'] }).creator.allowed).toBe(false);
  });

  it('puts the first layer of View at draw order 0, with the server\'s default label', async () => {
    const { creator: c, sent } = creator();
    const result = await c.create('First');
    expect(result).toMatchObject({ ok: true, name: 'First' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ entityType: 'layer', operation: 'create', data: { name: 'First', drawOrder: 0, visible: true, label: LABEL } });
  });

  it('sends nothing for an empty or too long name, or before the configuration has arrived', async () => {
    const { creator: c, sent } = creator();
    expect(await c.create('  ')).toEqual({ ok: false, reason: 'Name the new layer.' });
    expect(await c.create('x'.repeat(257))).toEqual({ ok: false, reason: 'At most 256 characters.' });
    expect(await creator({ label: null }).creator.create('Early')).toEqual({ ok: false, reason: 'The server\'s configuration has not arrived yet; try again.' });
    expect(sent).toEqual([]);
  });
});
