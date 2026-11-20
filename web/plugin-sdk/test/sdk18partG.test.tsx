// @vitest-environment jsdom
// SDK 1.8.0 part G (CR-0043; owner XD A, 2026-11-15; for PCA-draw-tactical): a PanelFrame without its
// heading, its foot after the scrolling body, and tile groups that start closed.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { PanelFoot, PanelFrame, TileGrid, type TileGroup } from '../src/index.ts';

afterEach(cleanup);

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'components', 'components.css'), 'utf8');

describe('SDK 1.8.0 part G: PanelFrame', () => {
  it('draws its heading by default, as before', () => {
    const page = render(<PanelFrame title="Objects">body</PanelFrame>);
    expect(page.getByRole('heading', { name: 'Objects' })).toBeTruthy();
    expect(page.getByRole('region', { name: 'Objects' })).toBeTruthy();
  });

  it('with heading={false} draws no heading, keeps the title as its name and the actions in their bar', () => {
    const page = render(<PanelFrame title="Graphics" heading={false}>body</PanelFrame>);
    expect(page.queryByRole('heading')).toBeNull();
    expect(page.getByRole('region', { name: 'Graphics' })).toBeTruthy();
    expect(page.container.querySelector('.emc2-panel-head')).toBeNull();
    const withActions = render(<PanelFrame title="Edit" heading={false} actions={<button type="button">Close</button>}>body</PanelFrame>);
    expect(withActions.queryByRole('heading')).toBeNull();
    expect(withActions.container.querySelector('.emc2-panel-head .emc2-panel-actions')?.textContent).toBe('Close');
  });

  it('draws its foot after the scrolling body, outside its padding', () => {
    const page = render(<PanelFrame title="Graphics" heading={false} foot={<PanelFoot><button type="button">Place</button></PanelFoot>}>tiles</PanelFrame>);
    const section = page.getByRole('region', { name: 'Graphics' });
    expect([...section.children].map((c) => c.className)).toEqual(['emc2-panel-body', 'emc2-panel-foot']);
    expect(section.querySelector('.emc2-panel-body .emc2-panel-foot')).toBeNull();
    expect(page.getByRole('group', { name: 'Panel actions' }).textContent).toBe('Place');
    expect([...render(<PanelFrame title="A">b</PanelFrame>).getByRole('region', { name: 'A' }).children].map((c) => c.className)).toEqual(['emc2-panel-head', 'emc2-panel-body']);
  });

  it('pins the foot in the CSS: no flex shrink, sticky at the bottom', () => {
    const rule = /\.emc2-panel > \.emc2-panel-foot \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('flex: none');
    expect(rule).toContain('position: sticky');
    expect(rule).toContain('bottom: 0');
  });
});

describe('SDK 1.8.0 part G: TileGroup.closed', () => {
  const lines: TileGroup = { id: 'lines', label: 'Lines', tiles: [{ id: 'boundary', label: 'Boundary', image: <svg /> }] };
  const areas: TileGroup = { id: 'areas', label: 'Areas', closed: true, tiles: [{ id: 'assembly', label: 'Assembly area', image: <svg /> }] };
  const later: TileGroup = { id: 'more', label: 'More', closed: true, tiles: [{ id: 'axis', label: 'Axis', image: <svg /> }] };
  function Grid() {
    const [all, setAll] = useState(false);
    return (
      <>
        <TileGrid label="Graphics" selected={null} onSelect={() => undefined} groups={all ? [lines, areas, later] : [lines, areas]} />
        <button type="button" onClick={() => setAll(true)}>All graphics</button>
      </>
    );
  }

  it('starts a closed group closed, opens it on its heading, and starts a group that joins later closed', () => {
    const page = render(<Grid />);
    expect(page.getByRole('button', { name: 'Lines' }).getAttribute('aria-expanded')).toBe('true');
    expect(page.getByRole('button', { name: 'Areas' }).getAttribute('aria-expanded')).toBe('false');
    expect(page.queryByRole('option', { name: 'Assembly area' })).toBeNull();
    expect(page.getByRole('option', { name: 'Boundary' }).getAttribute('tabindex')).toBe('0');
    fireEvent.click(page.getByRole('button', { name: 'Areas' }));
    expect(page.getByRole('option', { name: 'Assembly area' })).toBeTruthy();
    fireEvent.click(page.getByRole('button', { name: 'Areas' }));
    expect(page.queryByRole('option', { name: 'Assembly area' })).toBeNull();
    fireEvent.click(page.getByRole('button', { name: 'All graphics' }));
    expect(page.getByRole('button', { name: 'More' }).getAttribute('aria-expanded')).toBe('false');
    expect(page.queryByRole('option', { name: 'Axis' })).toBeNull();
  });
});
