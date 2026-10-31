import type { EntryPoint, Flow } from "../generated/contract";
import type { Model } from "../model/buildModel";

/** What the canvas shows, derived from the selection. */
export interface FlowSubject {
  flow: Flow | undefined;
  entry: EntryPoint | undefined;
  /** Entry or node to trace in Trace mode. */
  traceStart: string | undefined;
}

export function subjectOf(
  model: Model,
  selection: string | null,
  traceFrom: string | null,
): FlowSubject {
  const flow = selection ? model.flows.flowsById.get(selection) : undefined;
  const entry = selection
    ? (model.flows.entryPointsById.get(selection) ??
      (flow ? model.flows.entryPointsById.get(flow.entryPoint) : undefined))
    : undefined;
  return { flow, entry, traceStart: traceFrom ?? entry?.id ?? flow?.entryPoint };
}
