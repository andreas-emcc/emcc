/**
 * Where a node dragged in a shared `Tree` lands (internal, not exported; CR-0019).
 */
import type { TreeDrop, TreeNode } from './index.tsx';

/** Where on a row the pointer is: into a folder (its middle half), or before or after a row. */
export type DropPlace = 'into' | 'before' | 'after';

interface Found {
  readonly node: TreeNode;
  readonly parentId: string | null;
  readonly siblings: readonly TreeNode[];
}

function find(nodes: readonly TreeNode[], id: string, parentId: string | null = null): Found | null {
  for (const node of nodes) {
    if (node.id === id) return { node, parentId, siblings: nodes };
    if (node.children !== undefined) {
      const below = find(node.children, id, node.id);
      if (below !== null) return below;
    }
  }
  return null;
}

const holds = (node: TreeNode, id: string): boolean => node.id === id || (node.children ?? []).some((c) => holds(c, id));

/**
 * The drop of `dragId` at `place` on the row `targetId`, by the rule of {@link TreeDrop}: `index`
 * counts in the target folder's list after the dragged node has been taken out of it. Null when
 * the place is the dragged node itself or below it.
 */
export function dropTarget(nodes: readonly TreeNode[], dragId: string, targetId: string, place: DropPlace): TreeDrop | null {
  const dragged = find(nodes, dragId);
  const target = find(nodes, targetId);
  if (dragged === null || target === null || holds(dragged.node, targetId)) return null;
  if (place === 'into') return { id: dragId, parentId: targetId, index: (target.node.children ?? []).filter((c) => c.id !== dragId).length };
  const list = target.siblings.filter((c) => c.id !== dragId);
  const at = list.findIndex((c) => c.id === targetId);
  return { id: dragId, parentId: target.parentId, index: place === 'before' ? at : at + 1 };
}
