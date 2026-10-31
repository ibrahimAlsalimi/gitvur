import type {
  EntryPoint,
  Flow,
  FlowState,
  FlowStatus,
  RepoBundle,
  Structure,
} from "../generated/contract";

/** Where a node appears in a flow. `index` is the 0-based position in reading order. */
export interface StepRef {
  flowId: string;
  stepId: string;
  index: number;
}

/** Entry points and flows of a repository, indexed for the Flows tab and the map. */
export interface FlowIndex {
  /** Extractor entries, then agent entries whose ID the extractor does not use; by ID. */
  entryPoints: EntryPoint[];
  entryPointsById: Map<string, EntryPoint>;
  /** By ID. A flow whose ID repeats keeps its first occurrence. */
  flows: Flow[];
  flowsById: Map<string, Flow>;
  /** Flows by `entryPoint`, in ID order. Flows whose entry point is unknown are under their
   * (dangling) `entryPoint` key too, so they can still be listed. */
  flowsByEntry: Map<string, Flow[]>;
  flowStatusById: Map<string, FlowStatus>;
  /** Steps that show each node, by node ID, in flow then reading order. */
  flowsThroughNode: Map<string, StepRef[]>;
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Status computed from hashes alone, for when the report has none (missing, invalid, or
 * older than the flow): `broken` if the entry or any step node is missing, `stale` if a
 * step's hash differs. The validator's verdict, when present, always wins.
 */
export function localFlowStatus(
  flow: Flow,
  structure: Structure,
  entryIds: ReadonlySet<string>,
): FlowStatus {
  const hashes = new Map(structure.nodes.map((n) => [n.id, n.contentHash] as const));
  const staleSteps: string[] = [];
  let broken = !entryIds.has(flow.entryPoint);
  for (const step of flow.steps) {
    const hash = hashes.get(step.node);
    if (hash === undefined) broken = true;
    else if (hash !== step.basedOnHash) staleSteps.push(step.id);
  }
  const status: FlowState = broken ? "broken" : staleSteps.length > 0 ? "stale" : "current";
  return { id: flow.id, status, staleSteps: [...new Set(staleSteps)].sort() };
}

export function indexFlows(bundle: RepoBundle): FlowIndex {
  const { structure, annotations, report } = bundle;
  const staticEntries = structure.entryPoints ?? [];
  const staticIds = new Set(staticEntries.map((e) => e.id));
  const entryPoints = [
    ...staticEntries,
    ...(annotations?.entryPoints ?? []).filter((e) => !staticIds.has(e.id)),
  ].sort(byId);
  const entryPointsById = new Map(entryPoints.map((e) => [e.id, e] as const));

  const flowsById = new Map<string, Flow>();
  for (const flow of annotations?.flows ?? []) {
    if (!flowsById.has(flow.id)) flowsById.set(flow.id, flow);
  }
  const flows = [...flowsById.values()].sort(byId);

  const flowsByEntry = new Map<string, Flow[]>();
  const flowsThroughNode = new Map<string, StepRef[]>();
  const reported = new Map((report?.flows ?? []).map((f) => [f.id, f] as const));
  const entryIds = new Set(entryPointsById.keys());
  const flowStatusById = new Map<string, FlowStatus>();
  for (const flow of flows) {
    const list = flowsByEntry.get(flow.entryPoint);
    if (list) list.push(flow);
    else flowsByEntry.set(flow.entryPoint, [flow]);
    flowStatusById.set(
      flow.id,
      reported.get(flow.id) ?? localFlowStatus(flow, structure, entryIds),
    );
    flow.steps.forEach((step, index) => {
      const ref = { flowId: flow.id, stepId: step.id, index };
      const refs = flowsThroughNode.get(step.node);
      if (refs) refs.push(ref);
      else flowsThroughNode.set(step.node, [ref]);
    });
  }
  return {
    entryPoints,
    entryPointsById,
    flows,
    flowsById,
    flowsByEntry,
    flowStatusById,
    flowsThroughNode,
  };
}
