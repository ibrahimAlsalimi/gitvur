import { type AggregatedEdge, aggregateEdges, subtree } from "../../model/aggregateEdges";
import type { Model } from "../../model/buildModel";
import type { RelationEdgeType } from "./types";

/** Lines above every node (modules are large containers). */
const EDGE_Z = 1000;

/** Unresolved-call key used by the inspector's "Possible targets" toggle. */
export function unresolvedKey(u: {
  from: string;
  name: string;
  evidence: { line: number };
}): string {
  return `${u.from}|${String(u.evidence.line)}|${u.name}`;
}

function toEdges(lines: AggregatedEdge[], preview: boolean): RelationEdgeType[] {
  return lines.map((l) => ({
    id: `${preview ? "preview" : "rel"}:${l.id}`,
    source: l.source,
    target: l.target,
    type: "relation",
    zIndex: EDGE_Z,
    selectable: false,
    focusable: false,
    data: {
      kind: "relation",
      type: l.type,
      provenance: l.provenance,
      pairs: l.pairs,
      aggregated: l.aggregated,
      hop: l.hop,
      preview,
      offsetIndex: 0,
      offsetCount: 1,
    },
  }));
}

/** Assigns parallel offsets to lines joining the same two nodes (either direction). */
function offsetParallels(edges: RelationEdgeType[]): RelationEdgeType[] {
  const groups = new Map<string, RelationEdgeType[]>();
  for (const e of edges) {
    const key = [e.source, e.target].sort().join("|");
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  for (const group of groups.values()) {
    group.forEach((e, i) => {
      if (e.data) {
        e.data.offsetIndex = i;
        e.data.offsetCount = group.length;
      }
    });
  }
  return edges;
}

export interface RelationInput {
  model: Model;
  visibleOf: (id: string) => string | undefined;
  selectedId: string | null;
  hoverId: string | null;
  hops: 1 | 2;
  ambiguousOpen: ReadonlySet<string>;
}

/** Relationship lines for the selection (+ hover preview, + open ambiguous candidates). */
export function relationEdges({
  model,
  visibleOf,
  selectedId,
  hoverId,
  hops,
  ambiguousOpen,
}: RelationInput): {
  edges: RelationEdgeType[];
  /** Visible ids of every line endpoint (for dimming). */
  endpoints: Set<string>;
} {
  const edges: RelationEdgeType[] = [];
  const endpoints = new Set<string>();
  if (selectedId !== null && model.nodes.has(selectedId)) {
    const lines = aggregateEdges(model, selectedId, visibleOf, hops);
    edges.push(...toEdges(lines, false));
    for (const l of lines) {
      endpoints.add(l.source);
      endpoints.add(l.target);
    }
    // Ambiguous candidates for unresolved calls in the selection, when expanded.
    for (const id of subtree(model, selectedId)) {
      for (const u of model.unresolvedByFrom.get(id) ?? []) {
        if (!ambiguousOpen.has(unresolvedKey(u))) continue;
        const source = visibleOf(u.from);
        for (const candidate of u.candidates) {
          const target = visibleOf(candidate);
          if (source === undefined || target === undefined || source === target) continue;
          endpoints.add(source);
          endpoints.add(target);
          edges.push({
            id: `cand:${unresolvedKey(u)}>${candidate}`,
            source,
            target,
            type: "relation",
            zIndex: EDGE_Z,
            selectable: false,
            focusable: false,
            data: {
              kind: "candidate",
              type: "calls",
              provenance: "syntactic",
              pairs: [],
              aggregated: false,
              hop: 1,
              preview: false,
              offsetIndex: 0,
              offsetCount: 1,
              label: u.name,
            },
          });
        }
      }
    }
  }
  if (hoverId !== null && hoverId !== selectedId && model.nodes.has(hoverId)) {
    const selectedIds = new Set(edges.map((e) => `${e.source}|${e.target}`));
    edges.push(
      ...toEdges(aggregateEdges(model, hoverId, visibleOf, 1), true).filter(
        (e) => !selectedIds.has(`${e.source}|${e.target}`),
      ),
    );
  }
  return { edges: offsetParallels(edges), endpoints };
}
