import type { Evidence } from "../generated/contract";
import type { Model } from "../model/buildModel";

/** The line that justifies reaching a step: the AI evidence, or the static call site. */
export function incomingEvidence(
  model: Model,
  fromNode: string,
  toNode: string,
  evidence: Evidence | null | undefined,
  provenance: string,
): { evidence: Evidence; ai: boolean } | undefined {
  if (provenance === "ai") return evidence ? { evidence, ai: true } : undefined;
  for (const i of model.outgoing.get(fromNode) ?? []) {
    const e = model.edges[i];
    if (e?.to === toNode && e.type === "calls") return { evidence: e.evidence, ai: false };
  }
  return undefined;
}
