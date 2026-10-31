import type { Flow } from "../generated/contract";
import type { Model } from "../model/buildModel";

export interface PinnedStep {
  index: number;
  /** The map node that shows it (the element, or its nearest visible ancestor). */
  at: string;
}

/** Steps mapped to visible map nodes, and the deduplicated path between them. */
export function pinnedLayout(
  model: Model,
  flow: Flow,
  resolve: (id: string) => string | undefined,
): { steps: PinnedStep[]; path: [string, string][] } {
  const atByStep = new Map<string, string>();
  const steps: PinnedStep[] = [];
  flow.steps.forEach((step, index) => {
    if (!model.nodes.has(step.node)) return;
    const at = resolve(step.node);
    if (!at) return;
    if (!atByStep.has(step.id)) atByStep.set(step.id, at);
    steps.push({ index, at });
  });
  const seen = new Set<string>();
  const path: [string, string][] = [];
  for (const t of flow.transitions) {
    const a = atByStep.get(t.from);
    const b = atByStep.get(t.to);
    if (!a || !b || a === b || seen.has(`${a}>${b}`)) continue;
    seen.add(`${a}>${b}`);
    path.push([a, b]);
  }
  return { steps, path };
}
