import type { Model } from "../model/buildModel";
import { UNASSIGNED_MODULE_ID } from "../model/buildModel";
import { fileRows } from "../layout/fromModel";
import type { LayoutResult } from "../layout/types";
import type { FileNode, MapEdge, MapNode, ModuleNode, ProjectNode, RowNode } from "./types";

/** Deterministic module colours: sorted module ids → --gv-module-1..8; Unassigned is neutral. */
export function moduleColors(model: Model): Map<string, string> {
  const ids = [...model.nodes.values()]
    .filter((n) => n.kind === "module" && n.id !== UNASSIGNED_MODULE_ID)
    .map((n) => n.id)
    .sort();
  const colors = new Map(
    ids.map((id, i) => [id, `var(--gv-module-${String((i % 8) + 1)})`] as const),
  );
  colors.set(UNASSIGNED_MODULE_ID, "var(--gv-module-neutral)");
  return colors;
}

function languageOf(path: string): "py" | "ts" | "file" {
  if (path.endsWith(".py")) return "py";
  if (/\.(?:ts|tsx|mts|cts)$/.test(path)) return "ts";
  return "file";
}

function countDescendants(model: Model, id: string): number {
  let n = 0;
  const todo = [...(model.childrenById.get(id) ?? [])];
  while (todo.length > 0) {
    const next = todo.pop() as string;
    n += 1;
    todo.push(...(model.childrenById.get(next) ?? []));
  }
  return n;
}

/** React Flow nodes and edges for a laid-out model. Selection is applied separately. */
export function buildFlow(
  model: Model,
  layout: LayoutResult,
  expandedIds: ReadonlySet<string>,
  meta: { commitSha: string; languages: string[] },
): { nodes: MapNode[]; edges: MapEdge[] } {
  const colors = moduleColors(model);
  const nodes: MapNode[] = [];
  const project: ProjectNode = {
    id: model.rootId,
    type: "project",
    position: { x: layout.project.x, y: layout.project.y },
    width: layout.project.width,
    height: layout.project.height,
    data: {
      name: model.projectName,
      commitSha: meta.commitSha,
      languages: meta.languages,
      totals: model.totals,
    },
    selectable: false,
    focusable: false,
    draggable: false,
  };
  nodes.push(project);

  const edges: MapEdge[] = [];
  for (const moduleId of model.childrenById.get(model.rootId) ?? []) {
    const box = layout.modules[moduleId];
    const node = model.nodes.get(moduleId);
    if (!box || node?.kind !== "module") continue;
    const fileIds = model.childrenById.get(moduleId) ?? [];
    const moduleNode: ModuleNode = {
      id: moduleId,
      type: "module",
      position: { x: box.x, y: box.y },
      width: box.width,
      height: box.height,
      data: {
        node,
        stats: model.moduleStats.get(moduleId),
        color: colors.get(moduleId) ?? "var(--gv-module-neutral)",
        synthetic: node.synthetic,
        fileIds,
      },
      draggable: false,
    };
    nodes.push(moduleNode);
    if (layout.ranks[moduleId] === 0) {
      edges.push({
        id: `connector:${moduleId}`,
        source: model.rootId,
        target: moduleId,
        type: "connector",
        selectable: false,
        focusable: false,
      });
    }

    for (const fileId of fileIds) {
      const fileBox = layout.files[fileId];
      const file = model.nodes.get(fileId);
      if (!fileBox || !file) continue;
      const path = file.source?.file ?? fileId.slice("file:".length);
      const slash = path.lastIndexOf("/");
      const expanded = expandedIds.has(fileId);
      const fileNode: FileNode = {
        id: fileId,
        type: "file",
        parentId: moduleId,
        position: { x: fileBox.x, y: fileBox.y },
        width: fileBox.width,
        height: fileBox.height,
        data: {
          node: file,
          directory: slash >= 0 ? path.slice(0, slash) : "",
          language: languageOf(path),
          childCount: countDescendants(model, fileId),
          expanded,
        },
        draggable: false,
      };
      nodes.push(fileNode);
      if (!expanded) continue;
      for (const row of fileRows(model, fileId)) {
        const rowBox = layout.rows[row.id];
        const rowNode = model.nodes.get(row.id);
        if (!rowBox || !rowNode) continue;
        const parentKind = model.nodes.get(rowNode.parentId ?? "")?.kind;
        const count =
          row.kind === "class"
            ? (model.childrenById.get(row.id) ?? []).filter(
                (c) => model.nodes.get(c)?.kind === "function",
              ).length
            : rowNode.source
              ? rowNode.source.endLine - rowNode.source.startLine + 1
              : 0;
        const node: RowNode = {
          id: row.id,
          type: "row",
          parentId: fileId,
          extent: "parent",
          position: { x: rowBox.x, y: rowBox.y },
          width: rowBox.width,
          height: rowBox.height,
          data: { node: rowNode, depth: row.depth, count, method: parentKind === "class" },
          draggable: false,
        };
        nodes.push(node);
      }
    }
  }
  return { nodes, edges };
}

/**
 * Marks the selected node. Nodes whose selection state doesn't change keep their object
 * identity, so React Flow re-renders only the old and new selection.
 */
export function applySelection(nodes: MapNode[], selectedId: string | null): MapNode[] {
  return nodes.map((n) => {
    const selected = n.id === selectedId;
    return Boolean(n.selected) === selected ? n : { ...n, selected };
  });
}

function sameData(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => Object.is(a[k], b[k]));
}

/**
 * Returns `next` with every node that is unchanged since `previous` replaced by its previous
 * object. React Flow skips work for nodes whose object identity is unchanged, so an expand
 * only costs the nodes that actually moved or changed.
 */
export function reuseNodes(previous: ReadonlyMap<string, MapNode>, next: MapNode[]): MapNode[] {
  return next.map((node) => {
    const old = previous.get(node.id);
    if (
      old?.type === node.type &&
      old.parentId === node.parentId &&
      old.position.x === node.position.x &&
      old.position.y === node.position.y &&
      old.width === node.width &&
      old.height === node.height &&
      sameData(old.data, node.data)
    ) {
      return old;
    }
    return node;
  });
}
