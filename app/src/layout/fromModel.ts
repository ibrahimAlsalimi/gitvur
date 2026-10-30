import type { Model } from "../model/buildModel";
import type { LayoutFile, LayoutRequest, LayoutRow } from "./types";

/** The module containing `id` (itself if it is a module), or undefined for the project. */
export function moduleOf(model: Model, id: string): string | undefined {
  let current: string | null | undefined = id;
  while (current !== null && current !== undefined) {
    if (model.nodes.get(current)?.kind === "module") return current;
    current = model.parentById.get(current);
  }
  return undefined;
}

/** A file's classes and functions, depth-first in source order, with nesting depth. */
export function fileRows(
  model: Model,
  fileId: string,
  collapsed: ReadonlySet<string> = new Set(),
): LayoutRow[] {
  const rows: LayoutRow[] = [];
  const walk = (parent: string, depth: number) => {
    for (const id of model.childrenById.get(parent) ?? []) {
      const node = model.nodes.get(id);
      if (node?.kind !== "class" && node?.kind !== "function") continue;
      rows.push({ id, kind: node.kind, depth });
      // A folded class shows its own row only.
      if (!collapsed.has(id)) walk(id, depth + 1);
    }
  };
  walk(fileId, 0);
  return rows;
}

/**
 * Module → module dependencies from the extractor's file imports and calls (an importer
 * or caller depends on its target, so Dagre puts it above).
 */
export function moduleEdges(model: Model): [string, string][] {
  const seen = new Set<string>();
  const out: [string, string][] = [];
  for (const edge of model.edges) {
    if (edge.origin !== "structure" || (edge.type !== "imports" && edge.type !== "calls")) continue;
    const from = moduleOf(model, edge.from);
    const to = moduleOf(model, edge.to);
    if (from === undefined || to === undefined || from === to) continue;
    const key = `${from}\u0000${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([from, to]);
  }
  out.sort((a, b) => (a[0] + a[1] < b[0] + b[1] ? -1 : 1));
  return out;
}

/** The visible model as a layout request: every module and file; rows of expanded files. */
export function buildLayoutRequest(
  model: Model,
  expandedIds: ReadonlySet<string>,
  edges = moduleEdges(model),
  collapsed: ReadonlySet<string> = new Set(),
): LayoutRequest {
  const modules = (model.childrenById.get(model.rootId) ?? [])
    .filter((id) => model.nodes.get(id)?.kind === "module")
    .map((id) => ({
      id,
      files: (model.childrenById.get(id) ?? []).map((fileId): LayoutFile => {
        const expanded = expandedIds.has(fileId);
        return { id: fileId, expanded, rows: expanded ? fileRows(model, fileId, collapsed) : [] };
      }),
    }));
  return { modules, moduleEdges: edges };
}
