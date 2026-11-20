// @vitest-environment jsdom
// The shared Menu, List and Tree in a page (CR-0019): one Tab stop each, the arrow keys, and drag
// and drop in the tree. Enter and Space on the items are buttons' own clicks.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { List, ListRow, Menu, Tree, type TreeDrop, type TreeNode } from '../src/index.ts';
import { dropTarget } from '../src/components/tree.ts';

beforeAll(() => {
  // jsdom has no DragEvent, so drag events would lose clientY.
  const win = globalThis as unknown as Record<string, unknown>;
  if (win['DragEvent'] === undefined) win['DragEvent'] = class extends MouseEvent {};
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const focused = () => globalThis.document.activeElement?.textContent;
const tabStops = (root: HTMLElement, selector: string) => [...root.querySelectorAll<HTMLElement>(selector)].map((e) => e.tabIndex);

describe('Menu', () => {
  const items = [
    { id: 'off', label: 'Off', disabled: true, group: 'view' },
    { id: 'open', label: 'Open', group: 'view' },
    { id: 'rename', label: 'Rename', group: 'edit' },
    { id: 'delete', label: 'Delete', group: 'delete' },
  ];

  it('separates its groups, focuses the first enabled item when it appears, and is one Tab stop', () => {
    const page = render(<Menu label="Bookmark" items={items} onChoose={() => undefined} />);
    expect([...page.getByRole('menu').children].map((k) => k.getAttribute('role'))).toEqual(['none', 'none', 'separator', 'none', 'separator', 'none']);
    expect(focused()).toBe('Open');
    expect(tabStops(page.getByRole('menu'), '.emc2-menu-item:not(:disabled)')).toEqual([0, -1, -1]);
  });

  it('moves with Up and Down around the enabled items, wrapping, and with Home and End', () => {
    const page = render(<Menu label="Bookmark" items={items} onChoose={() => undefined} />);
    const menu = page.getByRole('menu');
    const seen: (string | undefined)[] = [];
    for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowUp', 'End', 'Home', 'ArrowUp']) {
      fireEvent.keyDown(globalThis.document.activeElement!, { key });
      seen.push(focused());
    }
    expect(seen).toEqual(['Rename', 'Delete', 'Open', 'Delete', 'Delete', 'Open', 'Delete']);
    expect(tabStops(menu, '.emc2-menu-item:not(:disabled)')).toEqual([-1, -1, 0]);
  });

  it('leaves keys with Alt, Ctrl or Cmd to the browser', () => {
    render(<Menu label="Bookmark" items={items} onChoose={() => undefined} />);
    for (const init of [{ key: 'ArrowDown', altKey: true }, { key: 'End', ctrlKey: true }, { key: 'ArrowUp', metaKey: true }]) {
      expect(fireEvent.keyDown(globalThis.document.activeElement!, init)).toBe(true);
    }
    expect(focused()).toBe('Open');
  });

  it('chooses an item by its id', () => {
    const onChoose = vi.fn();
    const page = render(<Menu label="Bookmark" items={items} onChoose={onChoose} />);
    fireEvent.click(page.getByRole('menuitem', { name: 'Rename' }));
    expect(onChoose).toHaveBeenCalledWith('rename');
  });
});

describe('List', () => {
  function Objects(props: { readonly onSelect: (name: string, additive: boolean) => void; readonly onActivate: (name: string) => void }) {
    return (
      <List label="Objects" multiselect>
        {['Alpha', 'Bravo', 'Charlie'].map((name) => (
          <ListRow key={name} selected={name === 'Bravo'} onSelect={(additive) => props.onSelect(name, additive)} onActivate={() => props.onActivate(name)}>
            {name}
          </ListRow>
        ))}
      </List>
    );
  }

  it('is one Tab stop, on the selected row, and multiselectable', () => {
    const page = render(<Objects onSelect={() => undefined} onActivate={() => undefined} />);
    const list = page.getByRole('listbox');
    expect([tabStops(list, '[role="option"]'), list.getAttribute('aria-multiselectable')]).toEqual([[-1, 0, -1], 'true']);
  });

  it('moves the focus with the arrows, Home and End, without selecting (owner, 2026-10-16)', () => {
    const onSelect = vi.fn();
    const page = render(<Objects onSelect={onSelect} onActivate={() => undefined} />);
    page.getByRole('option', { name: 'Bravo' }).focus();
    const seen: (string | undefined)[] = [];
    for (const key of ['ArrowDown', 'ArrowDown', 'ArrowUp', 'Home', 'ArrowUp', 'End']) {
      fireEvent.keyDown(globalThis.document.activeElement!, { key });
      seen.push(focused());
    }
    expect(seen).toEqual(['Charlie', 'Charlie', 'Bravo', 'Alpha', 'Alpha', 'Charlie']);
    expect(onSelect).not.toHaveBeenCalled();
    expect(tabStops(page.getByRole('listbox'), '[role="option"]')).toEqual([-1, -1, 0]);
  });

  it('puts the Tab stop back on the selected row when the selection changes elsewhere', () => {
    function Shared() {
      const [selected, setSelected] = useState('Bravo');
      return (
        <>
          <button type="button" onClick={() => setSelected('Charlie')}>
            Select on the map
          </button>
          <List label="Objects">
            {['Alpha', 'Bravo', 'Charlie'].map((name) => (
              <ListRow key={name} selected={name === selected}>
                {name}
              </ListRow>
            ))}
          </List>
        </>
      );
    }
    const page = render(<Shared />);
    page.getByRole('option', { name: 'Alpha' }).focus();
    fireEvent.focus(page.getByRole('option', { name: 'Alpha' }));
    page.getByRole('button').focus();
    fireEvent.click(page.getByRole('button'));
    expect(tabStops(page.getByRole('listbox'), '[role="option"]')).toEqual([-1, -1, 0]);
  });

  it('keeps one Tab stop when a row component adds rows on its own render', async () => {
    function Rows() {
      const [more, setMore] = useState(false);
      return (
        <>
          <ListRow onActivate={() => setMore(true)}>Alpha</ListRow>
          {more ? <ListRow>Bravo</ListRow> : null}
        </>
      );
    }
    const page = render(
      <List label="Objects">
        <Rows />
      </List>,
    );
    fireEvent.keyDown(page.getByRole('option', { name: 'Alpha' }), { key: 'Enter' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(tabStops(page.getByRole('listbox'), '[role="option"]')).toEqual([0, -1]);
  });

  it('selects with Space (Ctrl or Cmd adds), activates with Enter, and reports Ctrl or Cmd on a click', () => {
    const onSelect = vi.fn();
    const onActivate = vi.fn();
    const page = render(<Objects onSelect={onSelect} onActivate={onActivate} />);
    const alpha = page.getByRole('option', { name: 'Alpha' });
    // Space selects and does not scroll the pane (the ACA's review).
    expect(fireEvent.keyDown(alpha, { key: ' ' })).toBe(false);
    fireEvent.keyDown(alpha, { key: ' ', ctrlKey: true });
    fireEvent.keyDown(alpha, { key: 'Enter' });
    fireEvent.click(alpha, { metaKey: true });
    fireEvent.click(alpha);
    expect(onSelect.mock.calls).toEqual([['Alpha', false], ['Alpha', true], ['Alpha', true], ['Alpha', false]]);
    expect(onActivate).toHaveBeenCalledWith('Alpha');
  });
});

const nodes: readonly TreeNode[] = [
  { id: 'arctic', label: 'Arctic', children: [{ id: 'svalbard', label: 'Svalbard' }, { id: 'jan-mayen', label: 'Jan Mayen' }] },
  { id: 'empty', label: 'Empty', children: [] },
  { id: 'home', label: 'Home' },
  { id: 'gotland', label: 'Gotland' },
];

function Bookmarks(props: { readonly onToggle?: (id: string) => void; readonly onDrop?: (drop: TreeDrop) => void; readonly canDrop?: (id: string, parentId: string | null) => boolean; readonly selected?: string }) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  return (
    <Tree
      label="Bookmarks"
      nodes={nodes}
      expanded={expanded}
      selected={props.selected ?? null}
      onToggle={(id) => {
        props.onToggle?.(id);
        setExpanded((e) => {
          const next = new Set(e);
          if (!next.delete(id)) next.add(id);
          return next;
        });
      }}
      onChoose={() => undefined}
      {...(props.onDrop === undefined ? {} : { onDrop: props.onDrop })}
      {...(props.canDrop === undefined ? {} : { canDrop: props.canDrop })}
    />
  );
}

const item = (page: ReturnType<typeof render>, name: string) => page.getByRole('button', { name });

describe('Tree, keys', () => {
  it('shows only open folders, and is one Tab stop, on the selected item', () => {
    const page = render(<Bookmarks selected="home" />);
    expect(page.getAllByRole('treeitem').map((t) => [t.textContent, t.getAttribute('aria-expanded')])).toEqual([['Arctic', 'false'], ['Empty', 'false'], ['Home', null], ['Gotland', null]]);
    expect(tabStops(page.getByRole('tree'), '.emc2-tree-item')).toEqual([-1, -1, 0, -1]);
  });

  it('opens with Right and moves into the folder, closes with Left and moves up', () => {
    const onToggle = vi.fn();
    const page = render(<Bookmarks onToggle={onToggle} />);
    item(page, 'Arctic').focus();
    const press = (key: string) => {
      fireEvent.keyDown(globalThis.document.activeElement!, { key });
      return focused();
    };
    expect(press('ArrowRight')).toBe('Arctic');
    expect(page.getByRole('treeitem', { name: /Arctic/ }).getAttribute('aria-expanded')).toBe('true');
    expect([press('ArrowRight'), press('ArrowDown'), press('ArrowLeft'), press('ArrowLeft')]).toEqual(['Svalbard', 'Jan Mayen', 'Arctic', 'Arctic']);
    expect(onToggle.mock.calls).toEqual([['arctic'], ['arctic']]);
    expect([press('End'), press('ArrowUp'), press('Home'), press('ArrowUp')]).toEqual(['Gotland', 'Home', 'Arctic', 'Arctic']);
    expect(tabStops(page.getByRole('tree'), '.emc2-tree-item')).toEqual([0, -1, -1, -1]);
  });
});

describe('Tree, where a drop lands (dropTarget)', () => {
  it('goes into a folder at its end, and before or after a row in its folder, counting without the dragged node', () => {
    expect(dropTarget(nodes, 'home', 'arctic', 'into')).toEqual({ id: 'home', parentId: 'arctic', index: 2 });
    expect(dropTarget(nodes, 'home', 'empty', 'into')).toEqual({ id: 'home', parentId: 'empty', index: 0 });
    expect(dropTarget(nodes, 'home', 'gotland', 'after')).toEqual({ id: 'home', parentId: null, index: 3 });
    expect(dropTarget(nodes, 'arctic', 'gotland', 'before')).toEqual({ id: 'arctic', parentId: null, index: 2 });
    expect(dropTarget(nodes, 'gotland', 'svalbard', 'before')).toEqual({ id: 'gotland', parentId: 'arctic', index: 0 });
    expect(dropTarget(nodes, 'svalbard', 'jan-mayen', 'after')).toEqual({ id: 'svalbard', parentId: 'arctic', index: 1 });
  });

  it('never drops a node on itself or below itself', () => {
    expect([dropTarget(nodes, 'arctic', 'arctic', 'into'), dropTarget(nodes, 'arctic', 'svalbard', 'before'), dropTarget(nodes, 'home', 'home', 'after')]).toEqual([null, null, null]);
  });
});

describe('Tree, drag and drop', () => {
  const data = () => ({ effectAllowed: 'none', dropEffect: 'none', setData: vi.fn(), getData: () => '' });
  const rows = () => vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 100, right: 200, bottom: 120, width: 200, height: 20, x: 0, y: 100, toJSON: () => ({}) });

  it('drags only with onDrop', () => {
    expect(item(render(<Bookmarks />), 'Home').getAttribute('draggable')).toBeNull();
  });

  it('marks before or after a row by the half the pointer is in, into the middle of a folder row, and reports the drop', () => {
    rows();
    const onDrop = vi.fn();
    const page = render(<Bookmarks onDrop={onDrop} />);
    const dt = data();
    fireEvent.dragStart(item(page, 'Gotland'), { dataTransfer: dt });
    expect([dt.effectAllowed, dt.setData.mock.calls]).toEqual(['move', [['text/plain', 'Gotland']]]);
    const over = (name: string, clientY: number) => {
      const allowed = !fireEvent.dragOver(item(page, name), { dataTransfer: dt, clientY });
      return [allowed, item(page, name).className];
    };
    expect(over('Home', 104)).toEqual([true, 'emc2-tree-item emc2-tree-drop-before']);
    expect(over('Home', 116)).toEqual([true, 'emc2-tree-item emc2-tree-drop-after']);
    expect(over('Arctic', 110)).toEqual([true, 'emc2-tree-item emc2-tree-drop-into']);
    // A folder row's top and bottom quarters reorder (owner, 2026-10-16).
    expect(over('Arctic', 103)).toEqual([true, 'emc2-tree-item emc2-tree-drop-before']);
    expect(over('Empty', 117)).toEqual([true, 'emc2-tree-item emc2-tree-drop-after']);
    expect(item(page, 'Home').className).toBe('emc2-tree-item');
    fireEvent.drop(item(page, 'Home'), { dataTransfer: dt, clientY: 104 });
    expect(onDrop.mock.calls).toEqual([[{ id: 'gotland', parentId: null, index: 2 }]]);
    expect(page.container.querySelector('[class*="emc2-tree-drop-"]')).toBeNull();
  });

  it('shows a place that canDrop refuses, or the node itself, as not allowed, and drops nothing there', () => {
    rows();
    const onDrop = vi.fn();
    const page = render(<Bookmarks onDrop={onDrop} canDrop={(_, parentId) => parentId !== 'empty'} />);
    const dt = data();
    fireEvent.dragStart(item(page, 'Arctic'), { dataTransfer: dt });
    expect(fireEvent.dragOver(item(page, 'Empty'), { dataTransfer: dt, clientY: 110 })).toBe(true);
    expect([dt.dropEffect, item(page, 'Empty').className]).toEqual(['none', 'emc2-tree-item']);
    expect(fireEvent.dragOver(item(page, 'Arctic'), { dataTransfer: dt, clientY: 110 })).toBe(true);
    fireEvent.drop(item(page, 'Arctic'), { dataTransfer: dt, clientY: 110 });
    fireEvent.dragEnd(item(page, 'Arctic'), { dataTransfer: dt });
    expect(onDrop).not.toHaveBeenCalled();
  });
});
