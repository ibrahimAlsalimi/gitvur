import { describe, expect, it } from "vitest";

import { type LayoutInputEdge, type LayoutInputNode, backEdges, layoutFlow } from "./layoutFlow";

const node = (id: string, lane: string, height = 60): LayoutInputNode => ({
  id,
  lane,
  laneName: lane.toUpperCase(),
  width: 220,
  height,
});
const edge = (from: string, to: string, label?: number): LayoutInputEdge => ({
  id: `${from}>${to}`,
  from,
  to,
  ...(label ? { label: { width: label, height: 20 } } : {}),
});

describe("layoutFlow", () => {
  it("orders lanes by first appearance and ranks by longest path", () => {
    const layout = layoutFlow({
      nodes: [node("a", "cli"), node("b", "svc"), node("c", "db"), node("d", "svc")],
      // a→b→c, a→d→c: c sits below both; a→c is a shortcut that must not pull c up.
      edges: [edge("a", "b"), edge("b", "c"), edge("a", "c"), edge("a", "d"), edge("d", "c")],
    });
    expect(layout.lanes.map((l) => l.id)).toEqual(["cli", "svc", "db"]);
    expect(layout.lanes.map((l) => l.count)).toEqual([1, 2, 1]);
    const rank = (id: string) => layout.nodes[id]?.rank;
    expect([rank("a"), rank("b"), rank("d"), rank("c")]).toEqual([0, 1, 1, 2]);
    const lane0 = layout.lanes[0];
    const lane1 = layout.lanes[1];
    expect(lane0 && lane1 && lane1.x - (lane0.x + lane0.width)).toBe(24);
    expect(layout.nodes.b?.y).toBe(72 + 60 + 88);
  });

  it("places same-lane same-rank nodes side by side and widens the lane", () => {
    const layout = layoutFlow({
      nodes: [node("a", "x"), node("b", "x"), node("c", "x")],
      edges: [edge("a", "b"), edge("a", "c")],
    });
    const { b, c } = layout.nodes;
    expect(b?.y).toBe(c?.y);
    expect(b && c && c.x - (b.x + b.width)).toBe(16);
    expect(layout.lanes[0]?.width).toBe(220 * 2 + 16 + 2 * 20);
    expect(layout.width).toBe(layout.lanes[0]?.width);
  });

  it("routes back-edges round the right side of the source lane without re-ranking", () => {
    const edges = [edge("a", "b"), edge("b", "c"), edge("c", "a"), edge("b", "b")];
    expect([...backEdges(["a", "b", "c"], edges)].sort()).toEqual(["b>b", "c>a"]);
    const layout = layoutFlow({ nodes: [node("a", "x"), node("b", "x"), node("c", "x")], edges });
    expect(["a", "b", "c"].map((id) => layout.nodes[id]?.rank)).toEqual([0, 1, 2]);
    const loop = layout.edges.find((e) => e.id === "c>a");
    const lane = layout.lanes[0];
    expect(loop?.back).toBe(true);
    const channel = loop?.points[1]?.[0] ?? 0;
    expect(lane && channel > (layout.nodes.c?.x ?? 0) + 220 && channel < lane.x + lane.width).toBe(
      true,
    );
    const self = layout.edges.find((e) => e.id === "b>b");
    expect(self?.points[1]?.[0]).toBe(channel - 6); // a second channel, offset
  });

  it("brings a back-edge from a lane on the right into the target's right side", () => {
    const layout = layoutFlow({
      nodes: [node("a", "x"), node("b", "y")],
      edges: [edge("a", "b"), edge("b", "a")],
    });
    const back = layout.edges.find((e) => e.id === "b>a");
    const a = layout.nodes.a;
    expect(back?.back).toBe(true);
    expect(back?.points.at(-1)).toEqual([(a?.x ?? 0) + 220, (a?.y ?? 0) + 30]);
  });

  it("routes forward edges orthogonally through the gap below the source", () => {
    const layout = layoutFlow({
      nodes: [node("a", "x"), node("b", "y")],
      edges: [edge("a", "b", 80)],
    });
    const e = layout.edges[0];
    const a = layout.nodes.a;
    expect(e?.points).toHaveLength(4);
    expect(e?.points[1]?.[1]).toBe((a?.y ?? 0) + 60 + 44);
    expect(
      e?.points.every(
        (p, i, all) => i === 0 || p[0] === all[i - 1]?.[0] || p[1] === all[i - 1]?.[1],
      ),
    ).toBe(true);
    expect(e?.label?.x).toBe((layout.nodes.b?.x ?? 0) + 110 + 6);
    expect(layout.labelOverlaps).toEqual([]);
  });

  it("moves a label to the other side when it would cover a card", () => {
    // A tall card in the next lane reaches into the gap where the a→b label sits on the
    // right; the left side is free.
    const layout = layoutFlow({
      nodes: [node("a", "x"), node("c", "y", 300), node("b", "x")],
      edges: [edge("a", "b", 200)],
    });
    const label = layout.edges[0]?.label;
    const center = (layout.nodes.b?.x ?? 0) + 110;
    expect(label && label.x + label.width).toBe(center - 6);
    expect(layout.labelOverlaps).toEqual([]);
  });

  it("is deterministic, ignores duplicate IDs and unknown edges, and handles empty input", () => {
    const input = {
      nodes: [node("a", "x"), node("b", "y"), node("a", "z")],
      edges: [edge("a", "b"), edge("a", "missing")],
    };
    expect(layoutFlow(input)).toEqual(layoutFlow(structuredClone(input)));
    expect(layoutFlow(input).lanes.map((l) => l.id)).toEqual(["x", "y"]);
    expect(layoutFlow(input).edges).toHaveLength(1);
    expect(layoutFlow({ nodes: [], edges: [] })).toMatchObject({ lanes: [], width: 0 });
  });

  it("lays out a 25-step flow within budget", () => {
    const nodes = Array.from({ length: 25 }, (_, i) => node(`s${String(i)}`, `m${String(i % 4)}`));
    const edges = nodes.slice(1).map((n, i) => edge(`s${String(i)}`, n.id, 60));
    const start = performance.now();
    for (let i = 0; i < 20; i++) layoutFlow({ nodes, edges });
    expect((performance.now() - start) / 20).toBeLessThan(30);
  });
});

describe("paths", () => {
  it("fits small diagrams whole and keeps large ones readable from the top-left", async () => {
    const { fitViewport, exitPoint, MIN_READABLE_ZOOM } = await import("./paths");
    const small = { lanes: [], nodes: {}, edges: [], labelOverlaps: [], width: 400, height: 300 };
    expect(fitViewport(small, 800, 600)).toEqual({ x: 200, y: 8, zoom: 1 });
    const wide = { ...small, width: 1112, height: 900 };
    expect(fitViewport(wide, 780, 600)).toEqual({ x: 32, y: 0, zoom: MIN_READABLE_ZOOM });
    expect(exitPoint({ x: 0, y: 0, w: 100, h: 40 }, { x: 300, y: 0, w: 100, h: 40 })).toEqual([
      100, 20,
    ]);
    expect(exitPoint({ x: 0, y: 0, w: 100, h: 40 }, { x: 0, y: 200, w: 100, h: 40 })).toEqual([
      50, 40,
    ]);
  });
});

describe("layout budgets", () => {
  it("lays out a 300-card trace tree in under 150 ms", () => {
    // A call tree: breadth 4 per level over 6 modules, like a large default trace.
    const nodes = Array.from({ length: 300 }, (_, i) => ({
      id: `trace:${String(i + 1)}`,
      lane: `module:m${String(i % 6)}`,
      laneName: `M${String(i % 6)}`,
      width: 180,
      height: 48,
    }));
    const edges = nodes.slice(1).map((n, i) => ({
      id: `e${String(i)}`,
      from: `trace:${String(Math.floor(i / 4) + 1)}`,
      to: n.id,
    }));
    layoutFlow({ nodes, edges }); // warm up
    const runs = 5;
    const start = performance.now();
    for (let i = 0; i < runs; i++) layoutFlow({ nodes, edges, options: { laneWidth: 220 } });
    const ms = (performance.now() - start) / runs;
    expect(ms).toBeLessThan(150);
  });
});
