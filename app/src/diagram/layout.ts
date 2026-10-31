import dagre from "@dagrejs/dagre";
import type { Diagram } from "./model";
export const CARD_WIDTH = 280;
export const CARD_HEIGHT = 180;
export type DiagramPositions = Record<
  string,
  { x: number; y: number; width: number; height: number }
>;

/** Lay out each subsystem from the inside out. Child positions are relative to its container;
 * external edges determine subsystem placement, not a second graph of directory dependencies. */
export function layoutDiagram(
  a: Pick<Diagram, "components" | "relationships"> & Partial<Pick<Diagram, "mode">>,
): DiagramPositions {
  const positions: DiagramPositions = {};
  const byId = new Map(a.components.map((c) => [c.id, c]));
  const visiting = new Set<string>();
  const level = (parent?: string) => {
    const children = a.components.filter((c) => c.parent === parent);
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "LR", nodesep: 64, ranksep: 180, marginx: 28, marginy: 28 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const c of children) {
      if (visiting.has(c.id)) continue;
      visiting.add(c.id);
      const nested = a.components.some((child) => child.parent === c.id);
      const size = nested ? level(c.id) : { width: CARD_WIDTH, height: CARD_HEIGHT };
      positions[c.id] = { x: 0, y: 0, ...size };
      g.setNode(c.id, size);
      visiting.delete(c.id);
    }
    const visibleAncestor = (id: string): string | undefined => {
      const seen = new Set<string>();
      while (!g.hasNode(id)) {
        if (seen.has(id)) return;
        seen.add(id);
        const p = byId.get(id)?.parent;
        if (!p) return;
        id = p;
      }
      return id;
    };
    for (const r of a.relationships) {
      const from = visibleAncestor(r.from),
        to = visibleAncestor(r.to);
      if (from && to && from !== to) g.setEdge(from, to);
    }
    dagre.layout(g);
    // Fold long, shallow architecture chains into reading rows instead of shrinking
    // every card to fit one very wide strip. Retain Dagre's rank/branch ordering.
    const leavesOnly = children.every((c) => !a.components.some((child) => child.parent === c.id));
    const ranks = new Map<number, string[]>();
    for (const c of children) {
      const p = g.node(c.id) as { x: number; y: number } | undefined;
      if (p) ranks.set(p.x, [...(ranks.get(p.x) ?? []), c.id]);
    }
    if (a.mode !== "Structure-derived" && leavesOnly && children.length <= 20 && ranks.size > 3) {
      const ordered = [...ranks].sort(([a], [b]) => a - b);
      let rowY = 28;
      for (let start = 0; start < ordered.length; start += 3) {
        const row = ordered.slice(start, start + 3);
        const rowHeight = Math.max(...row.map(([, ids]) => ids.length * (CARD_HEIGHT + 64) - 64));
        row.forEach(([, ids], col) => {
          ids.sort((a, b) => (g.node(a) as { y: number }).y - (g.node(b) as { y: number }).y);
          const xCol = Math.floor(start / 3) % 2 ? 2 - col : col;
          ids.forEach((id, i) =>
            g.setNode(id, {
              x: 28 + xCol * (CARD_WIDTH + 180) + CARD_WIDTH / 2,
              y:
                rowY +
                (rowHeight - (ids.length * (CARD_HEIGHT + 64) - 64)) / 2 +
                i * (CARD_HEIGHT + 64) +
                CARD_HEIGHT / 2,
            }),
          );
        });
        rowY += rowHeight + 100;
      }
    }
    let width = CARD_WIDTH,
      height = CARD_HEIGHT;
    for (const c of children) {
      const p = g.node(c.id) as { x: number; y: number } | undefined;
      const size = positions[c.id];
      if (!p || !size) continue;
      size.x = p.x - size.width / 2;
      size.y = p.y - size.height / 2 + (parent ? 180 : 0);
      width = Math.max(width, size.x + size.width + 28);
      height = Math.max(height, size.y + size.height + 28);
    }
    return { width, height };
  };
  level();
  return positions;
}
