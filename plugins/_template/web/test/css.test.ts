// The look (ADR-0034): a plugin's CSS only arranges its content, from the shared tokens. The SDK's
// look check finds colours, lengths, fonts and shared classes that a plugin may not set; keep this
// test when you copy the template, with your plugin's id and CSS file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkLookCss } from '@emc2/plugin-sdk/testing';

const css = readFileSync(join(import.meta.dirname, '../src/template.css'), 'utf8');

describe('the CSS', () => {
  it('passes the shared look check', () => {
    expect(checkLookCss(css, { pluginId: 'template' })).toEqual([]);
  });

  it('would fail on a literal colour or length and on a shared class', () => {
    expect(checkLookCss('.template-x { color: #fff; padding: 4px; }', { pluginId: 'template' }).map((f) => f.rule)).toEqual(['colour', 'length']);
    expect(checkLookCss('.emc2-button { color: var(--emc2-color-text); }', { pluginId: 'template' }).map((f) => f.rule)).toEqual(['class']);
  });
});
