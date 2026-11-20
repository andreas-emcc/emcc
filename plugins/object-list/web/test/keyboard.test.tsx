// Acceptance criteria 9 and 10 of docs/plugins/briefs/object-list.md, as far as jsdom reaches: the
// keyboard (arrow keys, Space, Enter, the menu key), and the look (the stylesheet takes everything
// from the design tokens, ADR-0034). How the panel lays out in the left, the right and the bottom
// pane, in both densities and in a light and a dark look, is checked in the real shell.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MapObject, Uuid } from '@emc2/plugin-sdk';
import { checkLookCss } from '@emc2/plugin-sdk/testing';
import { fixture, layer, objectsOf, settle } from './helpers.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const css = readFileSync(join(import.meta.dirname, '../src/object-list.css'), 'utf8');

function rows(): HTMLElement[] {
  return within(screen.getByRole('listbox', { name: 'Objects of the layer' })).getAllByRole('option');
}

function tabStops(): number[] {
  return rows().flatMap((r, i) => (r.tabIndex === 0 ? [i] : []));
}

function focused(): number {
  return rows().indexOf(document.activeElement as HTMLElement);
}

/** Returns false when the key's default was prevented, as the browser sees it. */
function press(element: Element, key: string, init: KeyboardEventInit = {}): boolean {
  return fireEvent.keyDown(element, { key, ...init });
}

async function opened(count = 5, options: Parameters<typeof fixture>[2] = {}) {
  const l = layer('Alpha', 1);
  const objects: MapObject[] = objectsOf(l.id, count);
  const f = await fixture([l], objects, options);
  act(() => {
    f.service.open(l.id);
  });
  await settle();
  return { ...f, layer: l, objects };
}

describe('AC10: the panel can be used with the keyboard alone', () => {
  it('the list is one Tab stop: the first row, and the stop follows the focus', async () => {
    await opened();
    expect(tabStops()).toEqual([0]);
    act(() => {
      rows()[2]?.focus();
    });
    expect(tabStops()).toEqual([2]);
  });

  it('the arrow keys, Home and End move between rows, and stop at the ends', async () => {
    await opened();
    act(() => {
      rows()[0]?.focus();
    });
    expect(press(rows()[0] as Element, 'ArrowDown')).toBe(false);
    expect(focused()).toBe(1);
    press(rows()[1] as Element, 'ArrowDown');
    expect(focused()).toBe(2);
    press(rows()[2] as Element, 'ArrowUp');
    expect(focused()).toBe(1);
    press(rows()[1] as Element, 'End');
    expect(focused()).toBe(4);
    press(rows()[4] as Element, 'ArrowDown');
    expect(focused()).toBe(4);
    press(rows()[4] as Element, 'Home');
    expect(focused()).toBe(0);
    press(rows()[0] as Element, 'ArrowUp');
    expect(focused()).toBe(0);
    expect(tabStops()).toEqual([0]);
  });

  it('lets a row the keyboard moves to scroll clear of the controls that stay in view above the list', async () => {
    let measure: () => void = () => undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          measure = callback;
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    await opened();
    const panel = screen.getByRole('region', { name: 'Objects' });
    const controls = panel.querySelector('.object-list-controls');
    if (!controls) throw new Error('no controls');
    expect(panel.style.getPropertyValue('--object-list-controls-height')).toBe('0px');
    // The controls grow (the toolbar wraps in a narrower pane): the margin follows.
    controls.getBoundingClientRect = () => ({ height: 77 }) as DOMRect;
    act(() => {
      measure();
    });
    expect(panel.style.getPropertyValue('--object-list-controls-height')).toBe('77px');
    // The stylesheet gives every row that margin.
    expect(css).toMatch(/\.object-list-rows li\s*\{[^}]*scroll-margin-top:\s*var\(--object-list-controls-height/);
  });

  it('Space selects the row, Ctrl+Space adds or removes it, and the page does not scroll', async () => {
    const { map, objects } = await opened();
    if (!map) throw new Error('no map');
    act(() => {
      rows()[1]?.focus();
    });
    expect(press(rows()[1] as Element, ' ')).toBe(false);
    expect(map.selection.value).toEqual([objects[1]?.id]);

    press(rows()[3] as Element, ' ', { ctrlKey: true });
    expect(map.selection.value).toEqual([objects[1]?.id, objects[3]?.id]);
    press(rows()[1] as Element, ' ', { ctrlKey: true });
    expect(map.selection.value).toEqual([objects[3]?.id]);
    expect(rows().map((r) => r.getAttribute('aria-selected'))).toEqual(['false', 'false', 'false', 'true', 'false']);
  });

  it('Enter zooms the map to the object', async () => {
    const { map, objects } = await opened();
    if (!map) throw new Error('no map');
    map.setObjectPositions({ [objects[2]?.id as Uuid]: [14.25, 50.5] });
    act(() => {
      rows()[2]?.focus();
    });
    press(rows()[2] as Element, 'Enter');
    await settle();
    expect(map.zoomToCalls).toEqual([[objects[2]?.id]]);
    expect(map.viewport.center).toEqual([14.25, 50.5]);
  });

  it('the menu key and Shift+F10 open the object action menu at the row, with the same rules as the right click', async () => {
    const { ctx, map, objects } = await opened();
    if (!map) throw new Error('no map');
    act(() => {
      map.selection.set([objects[0]?.id as Uuid]);
    });
    // An unselected row becomes the selection first.
    act(() => {
      rows()[3]?.focus();
    });
    expect(press(rows()[3] as Element, 'ContextMenu')).toBe(false);
    expect(map.selection.value).toEqual([objects[3]?.id]);
    expect(ctx.openedMenus).toHaveLength(1);
    expect(ctx.openedMenus[0]?.target).toEqual({ objects: [objects[3]?.id] });
    expect(ctx.openedMenus[0]?.at).toHaveLength(2);

    // A selected row opens it for the whole selection.
    act(() => {
      map.selection.set([objects[1]?.id as Uuid, objects[2]?.id as Uuid, objects[4]?.id as Uuid]);
      rows()[2]?.focus();
    });
    expect(press(rows()[2] as Element, 'F10', { shiftKey: true })).toBe(false);
    expect(ctx.openedMenus.at(-1)?.target).toEqual({ objects: [objects[1]?.id, objects[2]?.id, objects[4]?.id] });
  });

  it('F10 alone opens nothing', async () => {
    const { ctx } = await opened();
    act(() => {
      rows()[0]?.focus();
    });
    expect(press(rows()[0] as Element, 'F10')).toBe(true);
    expect(ctx.openedMenus).toEqual([]);
  });

  it('every control is a native button or select, reachable with Tab and operated with Enter or Space', async () => {
    await opened();
    const panel = screen.getByRole('region', { name: 'Objects' });
    const controls = [...panel.querySelectorAll<HTMLElement>('button, select, input, textarea, [tabindex]')];
    for (const control of controls) {
      const native = ['BUTTON', 'SELECT', 'INPUT', 'TEXTAREA'].includes(control.tagName);
      const row = control.getAttribute('role') === 'option';
      expect(native || row).toBe(true);
      expect(control.tabIndex).toBeGreaterThanOrEqual(row ? -1 : 0);
    }
    // Names for the icon buttons, so a screen reader and a keyboard user know what they are on.
    for (const name of ['First page', 'Previous page', 'Next page', 'Last page', 'Refresh']) {
      expect(screen.getByRole('button', { name })).toBeDefined();
    }
    expect(screen.getByRole('combobox', { name: 'Layer' })).toBeDefined();
  });

  it('keeps one Tab stop on a new page, and arrow keys do nothing outside the rows', async () => {
    const l = layer('Alpha', 1);
    const f = await fixture([l], objectsOf(l.id, 150));
    act(() => {
      f.service.open(l.id);
    });
    await settle();
    expect(rows()).toHaveLength(100);
    act(() => {
      rows()[40]?.focus();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await settle();
    expect(rows()).toHaveLength(50);
    expect(tabStops()).toHaveLength(1);

    const refresh = screen.getByRole('button', { name: 'Refresh' });
    act(() => {
      refresh.focus();
    });
    expect(press(refresh, 'ArrowDown')).toBe(true);
    expect(document.activeElement).toBe(refresh);
  });
});

describe('AC9: the look (ADR-0034)', () => {
  it('takes every colour, font, size, space, radius and shadow from the design tokens, and names every class after the plugin (check 9)', () => {
    // The SDK test kit's rule (T-057, CR-0025 part 1). The one property of its own, `--object-list-controls-height`, is a
    // measured length (the controls' height), not a design value; `--<id>-` properties pass.
    expect(checkLookCss(css, { pluginId: 'object-list' })).toEqual([]);
    expect(css).toContain('--object-list-controls-height');
    // The rule passes an empty or token-less file too, so check that this one does use the tokens (and no literal weight, which the check leaves).
    expect(css.match(/var\(--emc2-/g)?.length ?? 0).toBeGreaterThan(5);
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/font-weight:\s*\d/);
  });

  it("finds what check 9 fails in this plugin's CSS, so the check runs on it", () => {
    const broken = `${css}\n.object-list-x { color: var(--shell-fg); padding: 2px; background: #fff; }\n.emc2-button { margin: 0; }\n.other { margin: 0; }`;
    const rules = checkLookCss(broken, { pluginId: 'object-list' }).map((f) => f.rule);
    expect(rules).toEqual(expect.arrayContaining(['alias', 'class', 'colour', 'length']));
  });

  it('has no global selector, and the one breakpoint is in the font\'s own unit so it follows the density', () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/:root|^\s*(html|body)\b/m);
    expect(rules).toMatch(/@container\s*\(max-width:\s*40em\)/);
  });

  it('draws its own heading nowhere: the shell\'s panel head names the panel', async () => {
    await opened();
    expect(screen.queryAllByRole('heading')).toEqual([]);
  });

  it('keeps the layer chooser, the paging and Refresh in one toolbar, so a low pane loses one row, not four', async () => {
    await opened();
    const toolbar = screen.getByRole('region', { name: 'Objects' }).querySelector('.object-list-toolbar');
    expect(toolbar).not.toBeNull();
    const inside = within(toolbar as HTMLElement);
    expect(inside.getByRole('combobox', { name: 'Layer' })).toBeDefined();
    for (const name of ['First page', 'Previous page', 'Next page', 'Last page', 'Refresh']) expect(inside.getByRole('button', { name })).toBeDefined();
    expect(inside.getByRole('status').textContent).toBe('1–5 of 5');
  });
});
