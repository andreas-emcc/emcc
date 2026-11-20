// Criterion 23, the look: the panels' CSS uses only the shell's tokens, with classes that start with
// the plugin id (ADR-0034; the shared look check of SDK 1.2.0).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkLookCss } from '@emc2/plugin-sdk/testing';

const css = readFileSync(join(import.meta.dirname, '../src/simulator.css'), 'utf8');

describe('the CSS (criterion 23)', () => {
  it('passes the shared look check', () => {
    expect(checkLookCss(css, { pluginId: 'simulator' })).toEqual([]);
  });
});
