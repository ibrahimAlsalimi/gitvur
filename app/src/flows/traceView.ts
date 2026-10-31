/** Turns a deterministic trace into a tree view: visibility, stubs, layout input. Pure. */
import type { Provenance, Trace, TraceNode } from "../generated/contract";
import type { Model } from "../model/buildModel";
import { chipSize, laneOf, locationOf, qualifiedName } from "./flowView";
import type { FlowLayoutInput } from "./layoutFlow";

export const TRACE_CARD_WIDTH = 180;
export const TRACE_CARD_HEIGHT = 48;
export const TRACE_STUB_HEIGHT = 30;
/** Depth initially expanded: depth 0, 1 and 2 are shown. */
export const INITIAL_DEPTH = 2;

export type TraceCardKind = "node" | "ref" | "cycle" | "ambiguous" | "candidate";

export interface TraceCard {
  /** Occurrence ID (`trace:3`), or `<occurrence>#<n>` for an ambiguous call's candidate. */
  id: string;
  kind: TraceCardKind;
  occurrence: TraceNode;
  /** Source node, for nodes, refs, cycles and candidates. */
  nodeId: string | undefined;
  title: string;
  location: string | undefined;
  lane: string;
  laneName: string;
  /** Children not drawn: collapsed ones plus those the trace omitted at its limits. */
  hidden: number;
  expanded: boolean;
  /** The trace stopped here at its limits: expanding asks the backend for more. */
  truncated: boolean;
  /** For refs and cycles: the occurrence ID of the first, expanded occurrence. */
  reference: string | undefined;
  height: number;
  width: number;
}

export interface TraceEdgeView {
  id: string;
  from: string;
  to: string;
  provenance: Provenance | "candidate";
  /** Recursion: drawn as a dashed loop back to the first occurrence. */
  loop: boolean;
}

export interface TraceView {
  cards: TraceCard[];
  cardsById: Map<string, TraceCard>;
  edges: TraceEdgeView[];
  input: FlowLayoutInput;
  /** Occurrences drawn (cards excluding candidates), for the truncation notice. */
  shown: number;
}

/** Occurrences expanded at first: nodes above `INITIAL_DEPTH`. */
export function initialExpanded(trace: Trace): Set<string> {
  return new Set(
    trace.nodes.filter((n) => n.kind === "node" && n.depth < INITIAL_DEPTH).map((n) => n.id),
  );
}

/**
 * Replaces the subtree under occurrence `at` with `sub` (a trace started from the same node,
 * whose single root stands for `at`). Grafted occurrence IDs are prefixed `<at>/` so they
 * never collide; depths shift by `at`'s depth. Refs inside the graft point within it.
 */
export function graftTrace(base: Trace, at: string, sub: Trace): Trace {
  const anchor = base.nodes.find((n) => n.id === at);
  const root = sub.nodes.find((n) => n.id === sub.roots[0]);
  if (!anchor || !root || anchor.node !== root.node) return base;
  const rename = (id: string) => `${at}/${id}`;
  // Drop the anchor's previous descendants.
  const byId = new Map(base.nodes.map((n) => [n.id, n] as const));
  const drop = new Set<string>();
  const stack = [...anchor.children];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    drop.add(id);
    stack.push(...(byId.get(id)?.children ?? []));
  }
  const grafted = sub.nodes
    .filter((n) => n.id !== root.id)
    .map((n) => ({
      ...n,
      id: rename(n.id),
      depth: n.depth + anchor.depth,
      children: n.children.map(rename),
      reference: n.reference === null ? null : n.reference === root.id ? at : rename(n.reference),
    }));
  const nodes = base.nodes
    .filter((n) => !drop.has(n.id))
    .map((n) =>
      n.id === at
        ? {
            ...n,
            children: root.children.map(rename),
            truncated: root.truncated,
            hiddenChildren: root.hiddenChildren,
          }
        : n,
    );
  nodes.push(...grafted);
  return {
    ...base,
    nodes,
    truncated: nodes.some((n) => n.truncated) || base.hiddenRoots > 0,
  };
}

function provenanceOf(model: Model, from: string | undefined, to: string | undefined): Provenance {
  if (!from || !to) return "syntactic";
  let best: Provenance | undefined;
  for (const i of model.outgoing.get(from) ?? []) {
    const e = model.edges[i];
    if (e?.to !== to || e.type !== "calls") continue;
    if (e.provenance === "syntactic") return "syntactic";
    best ??= e.provenance;
  }
  return best ?? "syntactic";
}

export function traceView(
  model: Model,
  trace: Trace,
  expanded: ReadonlySet<string>,
  openAmbiguous: ReadonlySet<string>,
): TraceView {
  const byId = new Map(trace.nodes.map((n) => [n.id, n] as const));
  const cards: TraceCard[] = [];
  const edges: TraceEdgeView[] = [];

  const card = (occ: TraceNode, parent: TraceNode | undefined): TraceCard => {
    const node = occ.node ? model.nodes.get(occ.node) : undefined;
    // Stubs sit in the lane of what they point at; ambiguous calls in the caller's lane.
    const laneNode = occ.kind === "ambiguous" ? parent?.node : occ.node;
    const lane = laneNode ? laneOf(model, laneNode) : laneOf(model, "");
    const isNode = occ.kind === "node";
    const open = isNode && expanded.has(occ.id);
    const stub = occ.kind === "ref" || occ.kind === "cycle";
    return {
      id: occ.id,
      kind: occ.kind,
      occurrence: occ,
      nodeId: occ.node ?? undefined,
      title: node ? qualifiedName(node) : occ.name,
      location: locationOf(node),
      ...lane,
      hidden: isNode ? (open ? 0 : occ.children.length) + occ.hiddenChildren : 0,
      expanded: open,
      truncated: occ.truncated,
      reference: occ.reference ?? undefined,
      height: stub ? TRACE_STUB_HEIGHT : TRACE_CARD_HEIGHT,
      width: TRACE_CARD_WIDTH,
    };
  };

  // Breadth-first over visible occurrences, so lanes appear in call order.
  const queue: { id: string; parent: TraceNode | undefined }[] = trace.roots.map((id) => ({
    id,
    parent: undefined,
  }));
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    const occ = item ? byId.get(item.id) : undefined;
    if (!item || !occ) continue;
    const c = card(occ, item.parent);
    cards.push(c);
    if (item.parent) {
      edges.push({
        id: `${item.parent.id}>${occ.id}`,
        from: item.parent.id,
        to: occ.id,
        provenance:
          occ.kind === "ambiguous"
            ? "candidate"
            : provenanceOf(model, item.parent.node ?? undefined, occ.node ?? undefined),
        loop: false,
      });
    }
    if (occ.kind === "node" && c.expanded) {
      for (const child of occ.children) queue.push({ id: child, parent: occ });
    }
    if (occ.kind === "ambiguous" && openAmbiguous.has(occ.id)) {
      occ.candidates.forEach((candidate, n) => {
        const node = model.nodes.get(candidate);
        const id = `${occ.id}#${String(n)}`;
        cards.push({
          ...c,
          id,
          kind: "candidate",
          nodeId: candidate,
          title: node ? qualifiedName(node) : candidate,
          location: locationOf(node),
          ...laneOf(model, candidate),
          hidden: 0,
          reference: undefined,
        });
        edges.push({
          id: `${occ.id}>${id}`,
          from: occ.id,
          to: id,
          provenance: "candidate",
          loop: false,
        });
      });
    }
  }
  const cardsById = new Map(cards.map((c) => [c.id, c] as const));
  for (const c of cards) {
    if (c.kind === "cycle" && c.reference && cardsById.has(c.reference)) {
      edges.push({
        id: `${c.id}~${c.reference}`,
        from: c.id,
        to: c.reference,
        provenance: "syntactic",
        loop: true,
      });
    }
  }
  const input: FlowLayoutInput = {
    nodes: cards.map((c) => ({
      id: c.id,
      lane: c.lane,
      laneName: c.laneName,
      width: c.width,
      height: c.height,
    })),
    edges: edges.map((e) => {
      const label = e.provenance === "ai" ? chipSize(undefined, true) : undefined;
      return { id: e.id, from: e.from, to: e.to, ...(label ? { label } : {}) };
    }),
    options: { laneWidth: 220, rankGap: 56, top: 64 },
  };
  return {
    cards,
    cardsById,
    edges,
    input,
    shown: cards.filter((c) => c.kind !== "candidate").length,
  };
}

/** The indented text format of `gitvur trace`, for the visible tree... of the whole trace. */
export function traceText(trace: Trace): string {
  const byId = new Map(trace.nodes.map((n) => [n.id, n] as const));
  const lines = [trace.start];
  const pending = [...trace.roots].reverse();
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    const n = byId.get(id);
    if (!n) continue;
    const marker = { node: "", ref: "↻ ", cycle: "⟲ ", ambiguous: "? " }[n.kind];
    let line = `${"  ".repeat(n.depth + 1)}${marker}${n.node ?? n.name}`;
    if (n.kind === "node") line += ` [${n.id}]`;
    if (n.reference) line += ` → ${n.reference}`;
    if (n.kind === "ambiguous") line += ` [${n.candidates.join(", ")}]`;
    if (n.truncated) line += ` … (${String(n.hiddenChildren)} hidden children)`;
    lines.push(line);
    pending.push(...[...n.children].reverse());
  }
  if (trace.hiddenRoots > 0) lines.push(`  … (${String(trace.hiddenRoots)} hidden roots)`);
  if (trace.roots.length === 0 && !trace.truncated) lines.push("  (no resolved execution roots)");
  return `${lines.join("\n")}\n`;
}
