import dagre from "@dagrejs/dagre";

import {
  CLASS_ROW_HEIGHT,
  DAGRE,
  FILE_GAP,
  FILE_HEIGHT,
  FILE_ROW_INSET,
  FILE_WIDTH,
  FUNCTION_ROW_HEIGHT,
  MODULE_HEADER,
  MODULE_PADDING,
  PROJECT_GAP,
  PROJECT_HEIGHT,
  ROW_INDENT,
  gridColumns,
} from "./constants";
import type { Box, LayoutModule, LayoutRequest, LayoutResult } from "./types";

/** One module's grid: its size and the boxes of its files and rows (relative). */
export interface ModuleGrid {
  width: number;
  height: number;
  files: Record<string, Box>;
  rows: Record<string, Box>;
}

/**
 * Layout cache, kept by the worker between requests:
 * - module grids, keyed by module id, valid while the module's signature matches;
 * - the Dagre ranking (rank and horizontal centre per module), valid while the module set,
 *   their widths and the module edges are unchanged. Expanding a file changes only heights,
 *   so it reuses the ranking and runs just the cheap vertical pass.
 */
export interface LayoutCache {
  grids: Map<string, { signature: string; grid: ModuleGrid }>;
  ranking?: { signature: string; ranks: Record<string, number>; centerX: Record<string, number> };
}

export function createLayoutCache(): LayoutCache {
  return { grids: new Map() };
}

/** Everything that affects a module's grid. */
function signature(module: LayoutModule): string {
  return module.files
    .map((f) =>
      f.expanded
        ? `${f.id}+${f.rows.map((r) => `${r.kind[0] ?? ""}${String(r.depth)}`).join("")}`
        : f.id,
    )
    .join("|");
}

function fileHeight(rows: LayoutModule["files"][number]["rows"], expanded: boolean): number {
  if (!expanded || rows.length === 0) return FILE_HEIGHT;
  const rowsHeight = rows.reduce(
    (h, r) => h + (r.kind === "class" ? CLASS_ROW_HEIGHT : FUNCTION_ROW_HEIGHT),
    0,
  );
  return FILE_HEIGHT + rowsHeight + FILE_ROW_INSET;
}

/** Packs a module's files into a row-major grid; each grid row takes its tallest card. */
export function computeModuleGrid(module: LayoutModule): ModuleGrid {
  const columns = gridColumns(module.files.length);
  const files: Record<string, Box> = {};
  const rows: Record<string, Box> = {};
  let y = MODULE_HEADER;
  for (let start = 0; start < module.files.length; start += columns) {
    const line = module.files.slice(start, start + columns);
    let tallest = 0;
    line.forEach((file, col) => {
      const height = fileHeight(file.rows, file.expanded);
      tallest = Math.max(tallest, height);
      files[file.id] = {
        x: MODULE_PADDING + col * (FILE_WIDTH + FILE_GAP),
        y,
        width: FILE_WIDTH,
        height,
      };
      if (!file.expanded) return;
      let rowY = FILE_HEIGHT;
      for (const row of file.rows) {
        const height = row.kind === "class" ? CLASS_ROW_HEIGHT : FUNCTION_ROW_HEIGHT;
        const indent = row.depth * ROW_INDENT;
        rows[row.id] = {
          x: FILE_ROW_INSET + indent,
          y: rowY,
          width: FILE_WIDTH - 2 * FILE_ROW_INSET - indent,
          height,
        };
        rowY += height;
      }
    });
    y += tallest + FILE_GAP;
  }
  const usedColumns = Math.max(1, Math.min(columns, module.files.length));
  const width = 2 * MODULE_PADDING + usedColumns * FILE_WIDTH + (usedColumns - 1) * FILE_GAP;
  const height =
    module.files.length === 0 ? MODULE_HEADER + MODULE_PADDING : y - FILE_GAP + MODULE_PADDING;
  return { width, height, files, rows };
}

/**
 * Containment layout: module grids (cached per module), then Dagre over modules only.
 * Re-running after one file expands recomputes that module's grid and the module level.
 */
export function computeLayout(
  request: LayoutRequest,
  cache: LayoutCache = createLayoutCache(),
): LayoutResult {
  const grids = new Map<string, ModuleGrid>();
  const recomputed: string[] = [];
  for (const module of request.modules) {
    const sig = signature(module);
    const cached = cache.grids.get(module.id);
    if (cached?.signature === sig) {
      grids.set(module.id, cached.grid);
    } else {
      const grid = computeModuleGrid(module);
      cache.grids.set(module.id, { signature: sig, grid });
      grids.set(module.id, grid);
      recomputed.push(module.id);
    }
  }
  for (const id of [...cache.grids.keys()]) if (!grids.has(id)) cache.grids.delete(id);

  const ranking = rankModules(request, grids, cache);

  // Vertical pass: each rank starts below the tallest module of the rank above.
  const top = PROJECT_HEIGHT + PROJECT_GAP;
  const rankHeight = new Map<number, number>();
  for (const module of request.modules) {
    const rank = ranking.ranks[module.id] ?? 0;
    rankHeight.set(
      rank,
      Math.max(rankHeight.get(rank) ?? 0, (grids.get(module.id) as ModuleGrid).height),
    );
  }
  const rankTop = new Map<number, number>();
  let y = top;
  for (const rank of [...rankHeight.keys()].sort((a, b) => a - b)) {
    rankTop.set(rank, y);
    y += (rankHeight.get(rank) ?? 0) + DAGRE.ranksep;
  }

  const modules: Record<string, Box> = {};
  const files: Record<string, Box> = {};
  const rows: Record<string, Box> = {};
  let width = 0;
  let height = top;
  for (const module of request.modules) {
    const grid = grids.get(module.id) as ModuleGrid;
    const rank = ranking.ranks[module.id] ?? 0;
    // Snap to the 4px grid so containers line up.
    const box = {
      x: Math.round(((ranking.centerX[module.id] ?? 0) - grid.width / 2) / 4) * 4,
      y: Math.round((rankTop.get(rank) ?? top) / 4) * 4,
      width: grid.width,
      height: grid.height,
    };
    modules[module.id] = box;
    width = Math.max(width, box.x + box.width + DAGRE.marginx);
    height = Math.max(height, box.y + box.height + DAGRE.marginy);
    Object.assign(files, grid.files);
    Object.assign(rows, grid.rows);
  }
  width = Math.max(width, FILE_WIDTH + 2 * DAGRE.marginx);
  const ranks = ranking.ranks;
  return {
    project: { x: 0, y: 0, width, height: PROJECT_HEIGHT },
    modules,
    files,
    rows,
    ranks,
    width,
    height,
    recomputed,
  };
}

/** Dagre ranks and horizontal centres; recomputed only when module widths or edges change. */
function rankModules(request: LayoutRequest, grids: Map<string, ModuleGrid>, cache: LayoutCache) {
  const signature = [
    request.modules
      .map((m) => `${m.id}:${String((grids.get(m.id) as ModuleGrid).width)}`)
      .join(","),
    request.moduleEdges.map(([a, b]) => `${a}>${b}`).join(","),
  ].join("|");
  if (cache.ranking?.signature === signature) return cache.ranking;

  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ ...DAGRE });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const module of request.modules) {
    // Heights don't affect ranking or order, and must not: expanding a file changes them.
    graph.setNode(module.id, { width: (grids.get(module.id) as ModuleGrid).width, height: 100 });
  }
  for (const [from, to] of request.moduleEdges) {
    if (from !== to && graph.hasNode(from) && graph.hasNode(to)) graph.setEdge(from, to);
  }
  dagre.layout(graph);

  const ranks: Record<string, number> = {};
  const centerX: Record<string, number> = {};
  for (const module of request.modules) {
    const node = graph.node(module.id) as { x: number; rank?: number };
    ranks[module.id] = node.rank ?? 0;
    centerX[module.id] = node.x;
  }
  // Dagre ranks may not start at 0; normalise.
  const minRank = Math.min(...Object.values(ranks), Infinity);
  if (Number.isFinite(minRank))
    for (const id of Object.keys(ranks)) ranks[id] = (ranks[id] ?? 0) - minRank;
  cache.ranking = { signature, ranks, centerX };
  return cache.ranking;
}
