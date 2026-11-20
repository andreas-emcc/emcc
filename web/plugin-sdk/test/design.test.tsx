import { readFileSync } from 'node:fs';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { Layers, Trash2 } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import {
  Button, ConfirmDialog, Icon, IconButton, Notice, PanelFrame, Popover, Slider, Tabs, TOKEN_ALIASES, TOKENS, tokenVar,
} from '../src/index.ts';
import type { TokenName } from '../src/index.ts';
import { createFakeContext, FAKE_TOKEN_VALUES } from '../src/testing/index.ts';

type Props = { readonly [key: string]: unknown; readonly children?: ReactNode };
const el = (node: ReactNode): ReactElement<Props> => {
  if (!isValidElement<Props>(node)) throw new Error('not an element');
  return node;
};
const kids = (node: ReactNode): ReactElement<Props>[] => {
  const c = el(node).props.children;
  return (Array.isArray(c) ? c.flat(Infinity) : [c]).filter((x): x is ReactElement<Props> => isValidElement(x));
};

describe('design tokens (ADR-0029, ADR-0034, CR-0015 items 18 and 19)', () => {
  it('names every token --emc2-…, once, including the focus style', () => {
    const properties = Object.values(TOKENS);
    expect(properties.every((p) => p.startsWith('--emc2-'))).toBe(true);
    expect(new Set(properties).size).toBe(properties.length);
    expect(TOKENS.focusColor).toBe('--emc2-focus-color');
    expect(tokenVar('sizeRow')).toBe('var(--emc2-size-row)');
  });

  it('keeps every 1.0.0 token as an alias of a 1.1.0 one', () => {
    expect(Object.keys(TOKEN_ALIASES).sort()).toEqual(['--control-pane-bg', '--error', '--muted', '--notification-bg', '--ok', '--pane-border', '--shell-bg', '--shell-fg', '--warning']);
    for (const name of Object.values(TOKEN_ALIASES)) expect(TOKENS[name]).toBeDefined();
  });

  it('has a fake value for every token, and switches the look with its listeners', () => {
    expect(Object.keys(FAKE_TOKEN_VALUES).sort()).toEqual((Object.keys(TOKENS) as TokenName[]).sort());
    const ctx = createFakeContext({ theme: { scheme: 'light' } });
    expect(ctx.theme.current).toEqual({ look: 'night-watch', scheme: 'light', density: 'compact' });
    const seen: unknown[] = [];
    ctx.theme.onChange((s) => seen.push([s.look, ctx.theme.tokens().colorText]));
    ctx.changeTheme({ look: 'chart-room', density: 'comfortable' }, { colorText: '#1c2830' });
    expect(seen).toEqual([['chart-room', '#1c2830']]);
  });
});

describe('the components\' CSS uses tokens only (ADR-0034)', () => {
  const css = readFileSync(new URL('../src/components/components.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('refers only to defined tokens', () => {
    const used = [...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]);
    const defined = new Set<string>(Object.values(TOKENS));
    expect(used.filter((p) => !defined.has(p!))).toEqual([]);
  });

  it('has no fixed colour, and no length but 1 px hairlines and the icon stroke', () => {
    expect(css.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/gi)).toBeNull();
    const lengths = [...css.matchAll(/(?<![\w-])(\d*\.?\d+)(px|rem|em)\b/g)].map((m) => m[0]);
    expect(lengths.filter((l) => l !== '1px' && l !== '1.75px')).toEqual([]);
  });

  it('draws an input\'s placeholder in the muted colour, at full opacity (T-110)', () => {
    const rule = /\.emc2-input::placeholder\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/color:\s*var\(--emc2-color-muted\);/);
    expect(rule).toMatch(/opacity:\s*1;/);
  });
});

describe('shared components (CR-0015 items 20 and 21)', () => {
  it('draws a decorative icon hidden, a named icon as an image', () => {
    expect(el(Icon({ icon: Layers })).props['aria-hidden']).toBe('true');
    const named = el(Icon({ icon: Layers, label: 'Layers' }));
    expect([named.props['role'], named.props['aria-label'], named.props['className']]).toEqual(['img', 'Layers', 'emc2-icon']);
  });

  it('builds buttons with their variant, and an icon button with its name', () => {
    expect(el(Button({ children: 'Delete', variant: 'danger' })).props['className']).toBe('emc2-button emc2-button-danger');
    const icon = el(IconButton({ icon: Trash2, label: 'Delete layer', disabled: true }));
    expect([icon.props['aria-label'], icon.props['title'], icon.props['disabled']]).toEqual(['Delete layer', 'Delete layer', true]);
  });

  it('frames a panel with its title and actions', () => {
    const frame = el(PanelFrame({ title: 'Objects', actions: 'x', children: 'body' }));
    expect(frame.props['aria-label']).toBe('Objects');
    expect(kids(frame).map((k) => k.props['className'])).toEqual(['emc2-panel-head', 'emc2-panel-body']);
  });

  it('marks the active tab (menus, lists and trees: keys.test.tsx)', () => {
    const tabs = el(Tabs({ label: 'Views', tabs: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], value: 'b', onChange: () => undefined }));
    expect(kids(tabs).map((k) => k.props['aria-selected'])).toEqual([false, true]);
  });

  it('shows a dialog and a popover only while open', () => {
    const closed = { open: false, title: 'Delete', message: 'Delete 3 objects?', confirmLabel: 'Delete 3 objects', onConfirm: () => undefined, onCancel: () => undefined };
    expect(ConfirmDialog(closed)).toBeNull();
    expect(Popover({ open: false, label: 'Bookmarks', onClose: () => undefined })).toBeNull();
  });



  it('formats a slider\'s value and gives notices a role', () => {
    const slider = kids(el(Slider({ label: 'Dim', value: 30, min: 0, max: 90, onChange: () => undefined, format: (v) => `${v} %` })));
    expect(slider.map((k) => k.props['aria-valuetext'] ?? k.props['children'])).toEqual(['Dim', '30 %', '30 %']);
    expect(el(Notice({ severity: 'error', children: 'Failed' })).props['role']).toBe('alert');
  });
});
