import { describe, expect, it } from 'vitest';
import { panelElementId } from './panels.ts';

describe("a panel's DOM id", () => {
  it('has letters, digits, - and _ only, different for different panels', () => {
    expect(panelElementId('bookmarks', 'tree')).toBe('panel-bookmarks-tree');
    expect(panelElementId('a-b', 'c')).not.toBe(panelElementId('a', 'b-c'));
    expect(panelElementId('x', 'a b/"c"')).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(panelElementId('x', 'a.b')).not.toBe(panelElementId('x', 'a_b'));
  });
});
