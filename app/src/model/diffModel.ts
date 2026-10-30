import type { DiffBundle, Edge, ElementChange, RepoBundle, Structure } from "../generated/contract";
import { type ChangeCounts, type ChangeInfo, type Model, buildModel } from "./buildModel";
import { ancestors } from "./tree";

/** The Changes lens's view of a diff: the union model plus what to expand and step through. */
export interface DiffView {
  bundle: DiffBundle;
  /** B's structure plus ghost nodes for removed elements, with `change` on every node. */
  model: Model;
  /** Elements to step through (N / Shift+N), in tree order: added, removed, moved, and
   * modified elements whose own lines may have changed (not containers that changed only
   * because a child did). */
  steps: string[];
  /** Ancestors of every changed element; everything else stays collapsed. */
  expanded: Set<string>;
  summary: ChangeCounts;
}

const edgeKey = (e: { from: string; to: string; type: string }) => `${e.from}|${e.to}|${e.type}`;

/** True for a change worth stepping to (see `DiffView.steps`). */
export function isStep(info: ChangeInfo | undefined): boolean {
  if (!info) return false;
  if (info.change === "modified") return !info.childChanged;
  return info.change !== "unchanged";
}

/**
 * Union of A and B: B's nodes, plus removed A nodes placed under their old parent (mapped
 * through moves), plus removed edges. Modules, descriptions and statuses come from `base`
 * (the repository as opened).
 */
export function unionStructure(bundle: DiffBundle): Structure {
  const { diff, from, to } = bundle;
  const movedTo = new Map(
    diff.elements.filter((e) => e.movedFrom !== undefined).map((e) => [e.movedFrom, e.id] as const),
  );
  const removed = new Set(diff.elements.filter((e) => e.change === "removed").map((e) => e.id));
  const ghosts = from.nodes
    .filter((n) => removed.has(n.id))
    .map((n) => {
      const parent = n.parentId === undefined ? undefined : (movedTo.get(n.parentId) ?? n.parentId);
      return parent === undefined ? { ...n } : { ...n, parentId: parent };
    });
  const removedEdges: Edge[] = diff.edges
    .filter((e) => e.change === "removed")
    .map((e) => ({
      from: e.from,
      to: e.to,
      type: e.type,
      provenance: e.provenance,
      evidence: e.evidence,
    }));
  return {
    nodes: [...to.nodes, ...ghosts],
    edges: [...to.edges, ...removedEdges],
    unresolvedCalls: to.unresolvedCalls,
  };
}

export function buildDiffView(bundle: DiffBundle, base: RepoBundle): DiffView {
  const structure = unionStructure(bundle);
  const model = buildModel({ ...base, structure });
  const byId = new Map<string, ElementChange>(bundle.diff.elements.map((e) => [e.id, e] as const));

  for (const node of model.nodes.values()) {
    if (node.kind === "project" || node.kind === "module") continue;
    const e = byId.get(node.id);
    const info: ChangeInfo = {
      change: e?.change ?? "unchanged",
      childChanged: e?.childChanged === true,
    };
    if (e?.movedFrom !== undefined) info.movedFrom = e.movedFrom;
    node.change = info;
  }

  // Edge changes: B's edges come first in `structure.edges`, then the removed ones.
  const added = new Set(bundle.diff.edges.filter((e) => e.change === "added").map(edgeKey));
  const bEdges = bundle.to.edges.length;
  model.edges.forEach((edge, i) => {
    if (edge.origin !== "structure") return;
    if (i >= bEdges) edge.change = "removed";
    else if (added.has(edgeKey(edge))) edge.change = "added";
  });

  // Steps in tree order; expansion; per-module counts.
  const steps: string[] = [];
  const expanded = new Set<string>();
  const summary: ChangeCounts = { added: 0, removed: 0, modified: 0, moved: 0 };
  const walk = (id: string) => {
    for (const child of model.childrenById.get(id) ?? []) {
      const node = model.nodes.get(child);
      if (node?.change && node.change.change !== "unchanged") {
        for (const a of ancestors(model, child)) expanded.add(a);
      }
      if (isStep(node?.change)) steps.push(child);
      walk(child);
    }
  };
  walk(model.rootId);
  for (const node of model.nodes.values()) {
    if (node.kind !== "module") continue;
    const counts: ChangeCounts = { added: 0, removed: 0, modified: 0, moved: 0 };
    const todo = [...(model.childrenById.get(node.id) ?? [])];
    while (todo.length > 0) {
      const d = model.nodes.get(todo.pop() as string);
      if (!d) continue;
      if (isStep(d.change) && d.change && d.change.change !== "unchanged") {
        counts[d.change.change] += 1;
        summary[d.change.change] += 1;
      }
      todo.push(...(model.childrenById.get(d.id) ?? []));
    }
    const any = counts.added + counts.removed + counts.modified + counts.moved > 0;
    node.change = { change: any ? "modified" : "unchanged", childChanged: any, counts };
  }
  return { bundle, model, steps, expanded, summary };
}
