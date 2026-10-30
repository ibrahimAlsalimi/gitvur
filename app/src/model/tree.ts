import type { Status } from "../generated/contract";
import type { Model, ModelNode } from "./buildModel";

export interface TreeRow {
  node: ModelNode;
  /** 1 for modules (the top level shown in the explorer). */
  level: number;
  hasChildren: boolean;
  expanded: boolean;
  /** 1-based position among siblings, and sibling count (for aria-posinset/setsize). */
  posInSet: number;
  setSize: number;
}

/** Rows visible in the explorer: the project's children, descending into expanded nodes. */
export function visibleRows(model: Model, expandedIds: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (parentId: string, level: number) => {
    const children = model.childrenById.get(parentId) ?? [];
    children.forEach((id, i) => {
      const node = model.nodes.get(id);
      if (!node) return;
      const hasChildren = (model.childrenById.get(id)?.length ?? 0) > 0;
      const expanded = hasChildren && expandedIds.has(id);
      rows.push({ node, level, hasChildren, expanded, posInSet: i + 1, setSize: children.length });
      if (expanded) walk(id, level + 1);
    });
  };
  walk(model.rootId, 1);
  return rows;
}

/**
 * Explorer rows filtered to one status: every element with that status, plus the
 * ancestors needed to place it, all expanded. The synthetic module never matches itself.
 */
export function filteredRows(model: Model, status: Status): TreeRow[] {
  const keep = new Set<string>();
  for (const node of model.nodes.values()) {
    if (node.kind === "project" || node.synthetic || node.docStatus !== status) continue;
    for (let id: string | null = node.id; id !== null && id !== model.rootId;) {
      if (keep.has(id)) break;
      keep.add(id);
      id = model.parentById.get(id) ?? null;
    }
  }
  const rows: TreeRow[] = [];
  const walk = (parentId: string, level: number) => {
    const children = (model.childrenById.get(parentId) ?? []).filter((id) => keep.has(id));
    children.forEach((id, i) => {
      const node = model.nodes.get(id);
      if (!node) return;
      const hasChildren = (model.childrenById.get(id) ?? []).some((c) => keep.has(c));
      rows.push({
        node,
        level,
        hasChildren,
        expanded: hasChildren,
        posInSet: i + 1,
        setSize: children.length,
      });
      walk(id, level + 1);
    });
  };
  walk(model.rootId, 1);
  return rows;
}

/** Default expansion: modules open, so files are visible ("collapsed at file level"). */
export function defaultExpanded(model: Model): Set<string> {
  return new Set(model.childrenById.get(model.rootId) ?? []);
}

/** Ids of every ancestor of `id`, nearest first (excluding the project root). */
export function ancestors(model: Model, id: string): string[] {
  const out: string[] = [];
  let current = model.parentById.get(id) ?? null;
  while (current !== null && current !== model.rootId) {
    out.push(current);
    current = model.parentById.get(current) ?? null;
  }
  return out;
}
