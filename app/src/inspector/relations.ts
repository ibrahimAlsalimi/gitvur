import type { UnresolvedCall } from "../generated/contract";
import { subtree } from "../model/aggregateEdges";
import type { Model, ModelEdge, ModelNode } from "../model/buildModel";

export type Direction = "out" | "in";

export interface RelationItem {
  edge: ModelEdge;
  /** The node at the other end. */
  otherId: string;
  direction: Direction;
}

export interface RelationGroup {
  /** Stable key, `type:direction`. */
  key: string;
  label: string;
  items: RelationItem[];
}

/** Section order and labels; empty groups are left out. */
const GROUPS: { type: ModelEdge["type"]; direction: Direction; label: string }[] = [
  { type: "calls", direction: "out", label: "Calls" },
  { type: "calls", direction: "in", label: "Called by" },
  { type: "imports", direction: "out", label: "Imports" },
  { type: "imports", direction: "in", label: "Imported by" },
  { type: "references", direction: "out", label: "References" },
  { type: "references", direction: "in", label: "Referenced by" },
  { type: "depends_on", direction: "out", label: "Depends on" },
  { type: "depends_on", direction: "in", label: "Depended on by" },
];

const PROVENANCE_ORDER: Record<ModelEdge["provenance"], number> = {
  syntactic: 0,
  semantic: 1,
  ai: 2,
};

/**
 * The node's own relationships, grouped by type and direction. Within a group: by
 * provenance (syntactic, semantic, AI), then the other node's id, then evidence line.
 */
export function relationGroups(model: Model, id: string): RelationGroup[] {
  const items = new Map<string, RelationItem[]>();
  const add = (indices: number[] | undefined, direction: Direction) => {
    for (const i of indices ?? []) {
      const edge = model.edges[i] as ModelEdge;
      const otherId = direction === "out" ? edge.to : edge.from;
      if (otherId === id) continue;
      const key = `${edge.type}:${direction}`;
      items.set(key, [...(items.get(key) ?? []), { edge, otherId, direction }]);
    }
  };
  add(model.outgoing.get(id), "out");
  add(model.incoming.get(id), "in");

  const groups: RelationGroup[] = [];
  for (const g of GROUPS) {
    const key = `${g.type}:${g.direction}`;
    const list = items.get(key);
    if (!list) continue;
    list.sort(
      (a, b) =>
        PROVENANCE_ORDER[a.edge.provenance] - PROVENANCE_ORDER[b.edge.provenance] ||
        (a.otherId < b.otherId ? -1 : a.otherId > b.otherId ? 1 : 0) ||
        a.edge.evidence.line - b.edge.evidence.line,
    );
    groups.push({ key, label: g.label, items: list });
  }
  return groups;
}

/** Unresolved calls made inside the node (itself and its descendants), by evidence line. */
export function unresolvedIn(model: Model, id: string): UnresolvedCall[] {
  const out: UnresolvedCall[] = [];
  for (const d of subtree(model, id)) out.push(...(model.unresolvedByFrom.get(d) ?? []));
  return out.sort(
    (a, b) =>
      (a.evidence.file < b.evidence.file ? -1 : a.evidence.file > b.evidence.file ? 1 : 0) ||
      a.evidence.line - b.evidence.line ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
}

/** Classes and functions in a file, depth-first in source order, with nesting depth. */
export function outline(model: Model, fileId: string): { node: ModelNode; depth: number }[] {
  const out: { node: ModelNode; depth: number }[] = [];
  const walk = (parent: string, depth: number) => {
    for (const child of model.childrenById.get(parent) ?? []) {
      const node = model.nodes.get(child);
      if (!node) continue;
      out.push({ node, depth });
      walk(child, depth + 1);
    }
  };
  walk(fileId, 0);
  return out;
}

/** The file containing a node (itself for a file), or undefined for modules and the project. */
export function fileOf(model: Model, id: string): ModelNode | undefined {
  let current: string | null = id;
  while (current !== null) {
    const node = model.nodes.get(current);
    if (!node || node.kind === "module" || node.kind === "project") return undefined;
    if (node.kind === "file") return node;
    current = node.parentId;
  }
  return undefined;
}

/** True for a function whose parent is a class. */
export function isMethod(model: Model, node: ModelNode): boolean {
  return node.kind === "function" && model.nodes.get(node.parentId ?? "")?.kind === "class";
}

/** Short display form of a content hash: the first 6 hex digits. */
export function shortHash(hash: string): string {
  return hash.replace(/^sha256:/, "").slice(0, 6);
}
