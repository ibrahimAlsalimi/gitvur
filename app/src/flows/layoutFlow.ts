/**
 * Swimlane layout for flows and traces. Pure and deterministic; runs in the layout worker.
 *
 * - Lanes: one per lane key (module), in order of first appearance in `nodes`.
 * - Ranks: longest path over forward edges from the first node. Back-edges (found by a DFS
 *   in reading order) are ignored for ranking and routed as loop-backs.
 * - Nodes sharing a lane and rank sit side by side, in input order; the lane grows to fit.
 * - Edges are orthogonal polylines. Forward edges leave the source's bottom, cross lanes in
 *   the gap just below the source's rank, and enter the target's top. Back-edges go round
 *   the right side of the source's lane.
 */

export interface LayoutInputNode {
  id: string;
  /** Lane key (a module ID) and its display name. */
  lane: string;
  laneName: string;
  width: number;
  height: number;
}

export interface LayoutInputEdge {
  id: string;
  from: string;
  to: string;
  /** Estimated label size, when the edge has a visible label. */
  label?: { width: number; height: number };
}

export interface FlowLayoutOptions {
  laneWidth: number;
  laneGap: number;
  rankGap: number;
  /** Horizontal gap between side-by-side nodes. */
  siblingGap: number;
  /** Space above the first rank (lane headers, the entry tag). */
  top: number;
  /** Space below the last rank. */
  bottom: number;
}

export interface FlowLayoutInput {
  nodes: LayoutInputNode[];
  edges: LayoutInputEdge[];
  options?: Partial<FlowLayoutOptions>;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LaidOutLane extends Rect {
  id: string;
  name: string;
  /** Distinct nodes in the lane. */
  count: number;
}

export interface LaidOutNode extends Rect {
  id: string;
  lane: string;
  rank: number;
}

export type Point = [number, number];

export interface LaidOutEdge {
  id: string;
  from: string;
  to: string;
  points: Point[];
  back: boolean;
  /** Where the label chip goes (top-left corner), when the edge has a label. */
  label?: Rect;
}

export interface FlowLayout {
  lanes: LaidOutLane[];
  nodes: Record<string, LaidOutNode>;
  edges: LaidOutEdge[];
  width: number;
  height: number;
  /** Labels that still overlap a card after trying both sides (for the visual review). */
  labelOverlaps: string[];
}

export const FLOW_LAYOUT_DEFAULTS: FlowLayoutOptions = {
  laneWidth: 260,
  laneGap: 24,
  rankGap: 88,
  siblingGap: 16,
  top: 72,
  bottom: 40,
};

/** Gap between a line and its label chip. */
const LABEL_GAP = 6;
/** Spacing of parallel back-edge channels on a lane's right side. */
const CHANNEL_STEP = 6;
const CHANNEL_INSET = 8;

/** Back-edges: edges into a node on the DFS stack, exploring in reading order from each root. */
export function backEdges(
  nodes: readonly string[],
  edges: readonly LayoutInputEdge[],
): Set<string> {
  const out = new Map<string, LayoutInputEdge[]>();
  for (const e of edges) {
    const list = out.get(e.from);
    if (list) list.push(e);
    else out.set(e.from, [e]);
  }
  const state = new Map<string, 1 | 2>(); // 1 = on stack, 2 = done
  const back = new Set<string>();
  for (const root of nodes) {
    if (state.has(root)) continue;
    // Iterative DFS: [node, next edge index].
    const stack: [string, number][] = [[root, 0]];
    state.set(root, 1);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (!top) break;
      const [id, i] = top;
      const list = out.get(id) ?? [];
      const edge = list[i];
      if (!edge) {
        state.set(id, 2);
        stack.pop();
        continue;
      }
      top[1] = i + 1;
      const s = state.get(edge.to);
      if (s === 1) back.add(edge.id);
      else if (s === undefined) {
        state.set(edge.to, 1);
        stack.push([edge.to, 0]);
      }
    }
  }
  return back;
}

/** Longest-path ranks over forward edges (Kahn's algorithm in reading order). */
export function longestPathRanks(
  nodes: readonly string[],
  edges: readonly LayoutInputEdge[],
  back: ReadonlySet<string>,
): Map<string, number> {
  const known = new Set(nodes);
  const indegree = new Map<string, number>(nodes.map((n) => [n, 0]));
  const out = new Map<string, string[]>();
  for (const e of edges) {
    if (back.has(e.id) || !known.has(e.from) || !known.has(e.to)) continue;
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
    const list = out.get(e.from);
    if (list) list.push(e.to);
    else out.set(e.from, [e.to]);
  }
  const rank = new Map<string, number>();
  const queue = nodes.filter((n) => indegree.get(n) === 0);
  for (const n of queue) rank.set(n, 0);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (id === undefined) continue;
    const r = rank.get(id) ?? 0;
    for (const to of out.get(id) ?? []) {
      rank.set(to, Math.max(rank.get(to) ?? 0, r + 1));
      const d = (indegree.get(to) ?? 0) - 1;
      indegree.set(to, d);
      if (d === 0) queue.push(to);
    }
  }
  for (const n of nodes) if (!rank.has(n)) rank.set(n, 0); // unreachable in a cycle-free view
  return rank;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function layoutFlow(input: FlowLayoutInput): FlowLayout {
  const o = { ...FLOW_LAYOUT_DEFAULTS, ...input.options };
  // First occurrence wins for duplicated IDs.
  const seen = new Set<string>();
  const nodes = input.nodes.filter((n) => !seen.has(n.id) && seen.add(n.id));
  const ids = nodes.map((n) => n.id);
  const edges = input.edges.filter((e) => seen.has(e.from) && seen.has(e.to));
  const back = backEdges(ids, edges);
  const rank = longestPathRanks(ids, edges, back);

  // Lanes in order of first appearance; groups of (lane, rank) in input order.
  const laneOrder: { id: string; name: string }[] = [];
  const laneIndex = new Map<string, number>();
  const groups = new Map<string, LayoutInputNode[]>();
  let maxRank = 0;
  for (const n of nodes) {
    if (!laneIndex.has(n.lane)) {
      laneIndex.set(n.lane, laneOrder.length);
      laneOrder.push({ id: n.lane, name: n.laneName });
    }
    const r = rank.get(n.id) ?? 0;
    maxRank = Math.max(maxRank, r);
    const key = `${n.lane}\u0000${String(r)}`;
    const g = groups.get(key);
    if (g) g.push(n);
    else groups.set(key, [n]);
  }
  const groupWidth = (g: readonly LayoutInputNode[]) =>
    g.reduce((w, n) => w + n.width, 0) + o.siblingGap * Math.max(0, g.length - 1);

  // Lane widths grow to fit their widest group (with the default side margin).
  const margin = Math.max(0, (o.laneWidth - Math.max(0, ...nodes.map((n) => n.width))) / 2);
  const laneWidths = laneOrder.map(() => o.laneWidth);
  for (const [key, g] of groups) {
    const lane = laneIndex.get(key.split("\u0000")[0] ?? "") ?? 0;
    laneWidths[lane] = Math.max(laneWidths[lane] ?? 0, groupWidth(g) + 2 * margin);
  }
  const laneX: number[] = [];
  let x = 0;
  for (const w of laneWidths) {
    laneX.push(x);
    x += w + o.laneGap;
  }
  const width = Math.max(0, x - o.laneGap);

  // Rank heights: the tallest node in each rank.
  const rankHeight = Array.from({ length: maxRank + 1 }, () => 0);
  for (const n of nodes) {
    const r = rank.get(n.id) ?? 0;
    rankHeight[r] = Math.max(rankHeight[r] ?? 0, n.height);
  }
  const rankY: number[] = [];
  let y = o.top;
  for (const h of rankHeight) {
    rankY.push(y);
    y += h + o.rankGap;
  }
  const height = (nodes.length > 0 ? y - o.rankGap : o.top) + o.bottom;

  const laidOut: Record<string, LaidOutNode> = {};
  for (const [key, g] of groups) {
    const laneKey = key.split("\u0000")[0] ?? "";
    const lane = laneIndex.get(laneKey) ?? 0;
    const r = rank.get(g[0]?.id ?? "") ?? 0;
    let nx = (laneX[lane] ?? 0) + ((laneWidths[lane] ?? 0) - groupWidth(g)) / 2;
    for (const n of g) {
      laidOut[n.id] = {
        id: n.id,
        lane: laneKey,
        rank: r,
        x: nx,
        y: rankY[r] ?? o.top,
        width: n.width,
        height: n.height,
      };
      nx += n.width + o.siblingGap;
    }
  }

  const lanes: LaidOutLane[] = laneOrder.map((l, i) => ({
    id: l.id,
    name: l.name,
    x: laneX[i] ?? 0,
    y: 0,
    width: laneWidths[i] ?? o.laneWidth,
    height,
    count: nodes.filter((n) => n.lane === l.id).length,
  }));

  const cards = Object.values(laidOut);
  const channels = new Map<string, number>();
  const labelOverlaps: string[] = [];
  const outEdges: LaidOutEdge[] = [];
  for (const e of edges) {
    const s = laidOut[e.from];
    const t = laidOut[e.to];
    if (!s || !t) continue;
    const isBack = back.has(e.id);
    let points: Point[];
    // The segment the label sits beside: [start, end] of a vertical run.
    let labelRun: [Point, Point];
    if (!isBack) {
      const sx = s.x + s.width / 2;
      const sy = s.y + s.height;
      const tx = t.x + t.width / 2;
      const ty = t.y;
      if (Math.abs(sx - tx) < 0.5) {
        points = [
          [sx, sy],
          [tx, ty],
        ];
        labelRun = [
          [sx, sy],
          [tx, ty],
        ];
      } else {
        const midY = sy + o.rankGap / 2;
        points = [
          [sx, sy],
          [sx, midY],
          [tx, midY],
          [tx, ty],
        ];
        labelRun = [
          [tx, midY],
          [tx, ty],
        ];
      }
    } else {
      const lane = lanes[laneIndex.get(s.lane) ?? 0];
      const used = channels.get(s.lane) ?? 0;
      channels.set(s.lane, used + 1);
      const cx = (lane ? lane.x + lane.width : s.x + s.width) - CHANNEL_INSET - used * CHANNEL_STEP;
      const sy = s.y + s.height / 2;
      if (t.lane === s.lane) {
        const ty = t.y + t.height / 2 + (t.id === s.id ? 12 : 0);
        points = [
          [s.x + s.width, sy],
          [cx, sy],
          [cx, ty],
          [t.x + t.width, ty],
        ];
      } else {
        const above = t.y - o.rankGap / 2;
        const tx = t.x + t.width / 2;
        points = [
          [s.x + s.width, sy],
          [cx, sy],
          [cx, above],
          [tx, above],
          [tx, t.y],
        ];
      }
      labelRun = [
        [cx, Math.min(sy, points[2]?.[1] ?? sy)],
        [cx, Math.max(sy, points[2]?.[1] ?? sy)],
      ];
    }
    const out: LaidOutEdge = { id: e.id, from: e.from, to: e.to, points, back: isBack };
    if (e.label) {
      const [a, b] = labelRun;
      const cy = (a[1] + b[1]) / 2 - e.label.height / 2;
      const right: Rect = { x: a[0] + LABEL_GAP, y: cy, ...e.label };
      const left: Rect = { x: a[0] - LABEL_GAP - e.label.width, y: cy, ...e.label };
      const hits = (r: Rect) => cards.some((c) => overlaps(r, c));
      const label = !hits(right) ? right : !hits(left) ? left : right;
      if (hits(label)) labelOverlaps.push(e.id);
      out.label = label;
    }
    outEdges.push(out);
  }

  return { lanes, nodes: laidOut, edges: outEdges, width, height, labelOverlaps };
}
