import dagre from "@dagrejs/dagre";
import type { Diagram } from "./model";
export const CARD_WIDTH = 260;
export const CARD_HEIGHT = 154;
export type DiagramPositions = Record<string, { x: number; y: number }>;
export function layoutDiagram(a: Pick<Diagram, "components" | "relationships">): DiagramPositions {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 48, ranksep: 160, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const c of a.components) g.setNode(c.id, { width: CARD_WIDTH, height: CARD_HEIGHT });
  for (const r of a.relationships)
    if (g.hasNode(r.from) && g.hasNode(r.to)) g.setEdge(r.from, r.to);
  dagre.layout(g);
  return Object.fromEntries(
    a.components.map((c) => {
      const p = g.node(c.id) as { x: number; y: number };
      return [c.id, { x: p.x - CARD_WIDTH / 2, y: p.y - CARD_HEIGHT / 2 }];
    }),
  );
}
