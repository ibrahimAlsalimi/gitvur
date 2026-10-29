import type { Edge } from "@xyflow/react";

import type { ModelEdge } from "../../model/buildModel";

export type RelationKind = "relation" | "candidate";

export interface RelationData extends Record<string, unknown> {
  kind: RelationKind;
  type: ModelEdge["type"];
  /** For candidates: `syntactic` (unused); styling uses `kind`. */
  provenance: ModelEdge["provenance"];
  pairs: ModelEdge[];
  aggregated: boolean;
  hop: 1 | 2;
  /** Lighter preview for the hovered node. */
  preview: boolean;
  /** Position among lines between the same two nodes, for offsetting parallels. */
  offsetIndex: number;
  offsetCount: number;
  /** Call name, for candidate lines. */
  label?: string;
}

export type RelationEdgeType = Edge<RelationData, "relation">;
