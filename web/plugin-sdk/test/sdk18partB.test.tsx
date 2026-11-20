// @vitest-environment jsdom
// SDK 1.8.0 part B (CR-0043; T-202, ADR-0056): the new tokens, the panel foot, chips and tiles.
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { Star } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';
import { CHIP_ICONS, Chip, PanelFoot, TileGrid, TOKENS, nextTile, type TileGroup } from '../src/index.ts';
import { FAKE_TOKEN_VALUES } from '../src/testing/index.ts';

afterEach(cleanup);

describe('SDK 1.8.0 part B: the tokens ADR-0056 names', () => {
  it('are the edge, the card edge, the raised surface, the edge width, the control radius and the label type', () => {
    expect(TOKENS).toMatchObject({
      colorEdge: '--emc2-color-edge', colorEdgeCard: '--emc2-color-edge-card', colorRaised: '--emc2-color-raised',
      edgeWidth: '--emc2-edge-width', radiusControl: '--emc2-radius-control',
      fontLabel: '--emc2-font-label', labelCase: '--emc2-label-case', labelLetterSpacing: '--emc2-label-letter-spacing', labelWeight: '--emc2-label-weight',
    });
    expect(FAKE_TOKEN_VALUES.edgeWidth).toBe('1px');
    expect(FAKE_TOKEN_VALUES.labelCase).toBe('none');
  });
});

describe('SDK 1.8.0 part B: PanelFoot', () => {
  it('holds the actions, and a status on its left when given', () => {
    const page = render(<PanelFoot status="2 unsaved changes"><button type="button">Apply</button></PanelFoot>);
    const foot = page.getByRole('group', { name: 'Panel actions' });
    expect(foot.className).toBe('emc2-panel-foot');
    expect(page.getByRole('status').textContent).toBe('2 unsaved changes');
    expect(foot.querySelector('.emc2-panel-foot-actions')?.textContent).toBe('Apply');
    cleanup();
    expect(render(<PanelFoot><button type="button">Place</button></PanelFoot>).queryByRole('status')).toBeNull();
  });
});

describe('SDK 1.8.0 part B: Chip', () => {
  it('always shows an icon and a word, the tone\'s icon by default (ADR-0056 point 5)', () => {
    const page = render(<><Chip tone="ok" label="OK" /><Chip tone="error" label="Failed" icon={Star} title="since 12:00" /></>);
    const [ok, failed] = [...page.container.querySelectorAll('.emc2-chip')];
    expect(ok?.className).toBe('emc2-chip emc2-chip-ok');
    expect(ok?.textContent).toBe('OK');
    expect(ok?.querySelector('svg')).not.toBeNull();
    expect(failed?.getAttribute('title')).toBe('since 12:00');
    expect(Object.keys(CHIP_ICONS)).toEqual(['ok', 'warning', 'error', 'info', 'neutral']);
  });
});

describe('SDK 1.8.0 part B: TileGrid', () => {
  it('moves like a List: previous, next, first and last, and nothing past the ends', () => {
    expect(nextTile('ArrowRight', 0, 3)).toBe(1);
    expect(nextTile('ArrowDown', 2, 3)).toBe(2);
    expect(nextTile('ArrowLeft', 0, 3)).toBe(0);
    expect(nextTile('ArrowUp', 2, 3)).toBe(1);
    expect(nextTile('Home', 2, 3)).toBe(0);
    expect(nextTile('End', 0, 3)).toBe(2);
    expect(nextTile('a', 0, 3)).toBeNull();
    expect(nextTile('End', 0, 0)).toBeNull();
  });

  const GROUPS: readonly TileGroup[] = [
    { id: 'lines', label: 'Boundaries and lines', tiles: [{ id: 'boundary', label: 'Boundary', image: <svg /> }, { id: 'phase', label: 'Phase line', image: <svg /> }] },
    { id: 'areas', label: 'Areas', tiles: [{ id: 'assembly', label: 'Assembly area', image: <svg />, disabled: true, title: 'Not in this standard' }] },
  ];
  function Grid() {
    const [selected, setSelected] = useState<string | null>('phase');
    return <TileGrid label="Graphics" selected={selected} onSelect={setSelected} groups={GROUPS} />;
  }

  it('is one Tab stop on the selected tile, and selects with a click, Enter or Space', () => {
    const page = render(<Grid />);
    const tiles = page.getAllByRole('option');
    expect(tiles.map((t) => t.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    expect(tiles[1]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(tiles[0]!);
    expect(page.getAllByRole('option')[0]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tiles[0]!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(page.getAllByRole('option')[1]);
    fireEvent.keyDown(page.getAllByRole('option')[1]!, { key: 'Enter' });
    expect(page.getAllByRole('option')[1]?.getAttribute('aria-selected')).toBe('true');
  });

  it('leaves a disabled tile unselected, and folds a group under its heading', () => {
    const page = render(<Grid />);
    const assembly = page.getByRole('option', { name: 'Assembly area' });
    expect(assembly.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(assembly);
    expect(assembly.getAttribute('aria-selected')).toBe('false');
    const head = page.getByRole('button', { name: 'Areas' });
    expect(head.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(head);
    expect(page.queryByRole('option', { name: 'Assembly area' })).toBeNull();
    expect(page.getByRole('button', { name: 'Areas' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('takes a plain list of tiles without headings', () => {
    const page = render(<TileGrid label="Symbols" selected={null} onSelect={() => undefined} tiles={[{ id: 'a', label: 'A', image: <svg /> }]} />);
    expect(page.queryAllByRole('button')).toHaveLength(0);
    expect(page.getByRole('option').getAttribute('tabindex')).toBe('0');
  });
});
