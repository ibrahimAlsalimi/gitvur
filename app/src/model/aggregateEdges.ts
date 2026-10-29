import type { Model, ModelEdge } from "./buildModel";

/** One drawn relationship line: one or more model edges between two visible nodes. */
export interface AggregatedEdge {
  /** Stable id: `source|target|type|provenance`. */
  id: string;
  /** Visible endpoint ids (the nearest visible ancestor of each real endpoint). */
  source: string;
  target: string;
  type: ModelEdge["type"];
  provenance: ModelEdge["provenance"];
  /** The underlying model edges, in model order. */
  pairs: ModelEdge[];
  /** True when at least one endpoint was lifted to an ancestor. */
  aggregated: boolean;
  /** 1 for edges touching the selection, 2 for the second hop. */
  hop: 1 | 2;
}

/** Ids in `id`'s subtree (itself and all descendants). */
export function subtree(model: Model, id: string): Set<string> {
  const out = new Set<string>([id]);
  const todo = [id];
  while (todo.length > 0) {
    for (const child of model.childrenById.get(todo.pop() as string) ?? []) {
      out.add(child);
      todo.push(child);
    }
  }
  return out;
}

/** Indices of edges with at least one endpoint in `ids`. */
function touching(model: Model, ids: ReadonlySet<string>): Set<number> {
  const out = new Set<number>();
  for (const id of ids) {
    for (const i of model.outgoing.get(id) ?? []) out.add(i);
    for (const i of model.incoming.get(id) ?? []) out.add(i);
  }
  return out;
}

/**
 * Relationship lines for a focus node, lifted to what is visible.
 *
 * - Hop 1: every edge with an endpoint in the focus node's subtree.
 * - Hop 2 (when `hops` is 2): every edge touching the other real endpoints of hop-1 edges.
 * - Each endpoint is mapped by `visibleOf` to its nearest visible ancestor; edges that
 *   become a self-loop (both ends on the same visible node) are dropped.
 * - Lines are grouped by (source, target, type, provenance); `pairs` keeps the originals.
 */
export function aggregateEdges(
  model: Model,
  focusId: string,
  visibleOf: (id: string) => string | undefined,
  hops: 1 | 2 = 1,
): AggregatedEdge[] {
  const focus = subtree(model, focusId);
  const first = touching(model, focus);
  const hopOf = new Map<number, 1 | 2>([...first].map((i) => [i, 1] as const));
  if (hops === 2) {
    const neighbours = new Set<string>();
    for (const i of first) {
      const e = model.edges[i] as ModelEdge;
      if (!focus.has(e.from)) neighbours.add(e.from);
      if (!focus.has(e.to)) neighbours.add(e.to);
    }
    for (const i of touching(model, neighbours)) if (!hopOf.has(i)) hopOf.set(i, 2);
  }

  const groups = new Map<string, AggregatedEdge>();
  for (const i of [...hopOf.keys()].sort((a, b) => a - b)) {
    const edge = model.edges[i] as ModelEdge;
    const source = visibleOf(edge.from);
    const target = visibleOf(edge.to);
    if (source === undefined || target === undefined || source === target) continue;
    const id = `${source}|${target}|${edge.type}|${edge.provenance}`;
    const hop = hopOf.get(i) as 1 | 2;
    const group = groups.get(id);
    if (group) {
      group.pairs.push(edge);
      group.aggregated ||= source !== edge.from || target !== edge.to;
      if (hop < group.hop) group.hop = hop;
    } else {
      groups.set(id, {
        id,
        source,
        target,
        type: edge.type,
        provenance: edge.provenance,
        pairs: [edge],
        aggregated: source !== edge.from || target !== edge.to,
        hop,
      });
    }
  }
  return [...groups.values()];
}

/**
 * Nearest visible ancestor for the map. Rows (classes, functions) are visible only at full
 * detail inside an expanded file; files at mid and full detail; modules always.
 */
export function visibleAncestor(
  model: Model,
  expandedIds: ReadonlySet<string>,
  lod: 0 | 1 | 2,
): (id: string) => string | undefined {
  const cache = new Map<string, string | undefined>();
  const resolve = (id: string): string | undefined => {
    if (cache.has(id)) return cache.get(id);
    const node = model.nodes.get(id);
    let result: string | undefined;
    if (!node || node.kind === "project") result = undefined;
    else if (node.kind === "module") result = id;
    else if (node.kind === "file") result = lod >= 1 ? id : resolve(node.parentId ?? "");
    else {
      // Class or function: visible only if its file is expanded and we are at full detail.
      let file: string | null = node.parentId;
      while (file !== null && model.nodes.get(file)?.kind !== "file")
        file = model.parentById.get(file) ?? null;
      result = lod === 2 && file !== null && expandedIds.has(file) ? id : resolve(file ?? "");
    }
    cache.set(id, result);
    return result;
  };
  return resolve;
}

/** "3 calls", "1 import", "2 references". */
export function countLabel(count: number, type: ModelEdge["type"]): string {
  const noun = {
    calls: "call",
    imports: "import",
    depends_on: "dependency",
    references: "reference",
  }[type];
  const plural = noun === "dependency" ? "dependencies" : `${noun}s`;
  return `${String(count)} ${count === 1 ? noun : plural}`;
}
