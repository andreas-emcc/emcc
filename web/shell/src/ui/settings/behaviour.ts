/** A data type's behaviour in the Settings tab (ADR-0023 point 7). */
import type { DataTypeDefaults } from '@emc2/plugin-sdk';
import { fieldOf, type JsonObject } from './schema.ts';

/** The behaviour as ECore takes it (server PluginHost.changeBehaviour), as a form. */
export const BEHAVIOUR = fieldOf({
  type: 'object',
  properties: {
    expiresAfterSeconds: {
      title: 'Expires after (seconds)', type: 'integer', minimum: 1,
      description: 'How long an object stays current after it was observed or last changed, unless it sets its own expiry time. Empty: never.',
    },
    fadeWhenExpired: { title: 'Fade when expired', type: 'boolean', description: 'The map shows expired objects faded.' },
    removeAfterExpirySeconds: {
      title: 'Remove after expiry (seconds)', type: 'integer', minimum: 0,
      description: 'How long an expired object stays before it is removed; 0 removes it when it expires. Empty: never removed.',
    },
  },
  required: ['fadeWhenExpired'],
}, 'Behaviour');

/** The behaviour as the form shows and sends it: `fadeWhenExpired` always set. */
export function behaviourValues(b: DataTypeDefaults): JsonObject {
  return {
    ...(b.expiresAfterSeconds === undefined ? {} : { expiresAfterSeconds: b.expiresAfterSeconds }),
    fadeWhenExpired: b.fadeWhenExpired ?? false,
    ...(b.removeAfterExpirySeconds === undefined ? {} : { removeAfterExpirySeconds: b.removeAfterExpirySeconds }),
  };
}

/** "never expire, not faded, never removed" and the like. */
export function describeBehaviour(b: DataTypeDefaults): string {
  return [
    b.expiresAfterSeconds === undefined ? 'never expire' : `expire after ${String(b.expiresAfterSeconds)} s`,
    b.fadeWhenExpired === true ? 'faded when expired' : 'not faded',
    b.removeAfterExpirySeconds === undefined ? 'never removed' : `removed ${String(b.removeAfterExpirySeconds)} s after expiry`,
  ].join(', ');
}
