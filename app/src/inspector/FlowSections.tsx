/** Inspector sections for flows: step context (Flows tab), flows through a node, trace action. */
import { copy } from "../copy";
import { incomingEvidence } from "../flows/evidence";
import { qualifiedName } from "../flows/flowView";
import { useFlowsStore } from "../flows/useFlowsStore";
import type { Model, ModelNode } from "../model/buildModel";
import { useAppStore } from "../store/useAppStore";
import { CodeViewer } from "./CodeViewer";

/**
 * Top of the inspector in the Flows tab: the active (or last clicked) step, where it was
 * reached from, and that line in the code.
 */
export function StepContext({ model }: { model: Model }) {
  const selection = useAppStore((s) => s.flowSelection);
  const mode = useAppStore((s) => s.flowMode);
  const playback = useFlowsStore((s) => s.playback);
  const inspected = useFlowsStore((s) => s.inspected);
  const flow = selection ? model.flows.flowsById.get(selection) : undefined;
  if (!flow || mode !== "flow") return null;
  const stepId = playback.current ?? inspected;
  const index = flow.steps.findIndex((s) => s.id === stepId);
  const step = flow.steps[index];
  if (!step) return null;
  // The transition that led here: from playback, else the first incoming one.
  const via = playback.current === step.id ? playback.path.at(-1)?.via : undefined;
  const transition =
    via !== null && via !== undefined
      ? flow.transitions[via]
      : flow.transitions.find((t) => t.to === step.id);
  const fromIndex = transition ? flow.steps.findIndex((s) => s.id === transition.from) : -1;
  const from = flow.steps[fromIndex];
  const fromNode = from ? model.nodes.get(from.node) : undefined;
  const found =
    transition && from
      ? incomingEvidence(model, from.node, step.node, transition.evidence, transition.provenance)
      : undefined;
  const fromName = fromNode ? qualifiedName(fromNode) : (from?.node ?? "");
  return (
    <div className="gv-insp gv-step-context-wrap">
      <section className="gv-insp-section gv-step-context" aria-label={copy.flows.stepContext}>
        <h3 className="gv-insp-heading">{copy.flows.stepContext}</h3>
        <p className="gv-step-context-title">
          <span className="gv-step-badge gv-step-badge-inline">{index + 1}</span>
          {step.label}
        </p>
        {from && (
          <p className="gv-step-context-from">
            {found
              ? copy.flows.calledFrom(fromIndex + 1, fromName, found.evidence.line)
              : copy.flows.reachedFrom(fromIndex + 1, fromName)}
          </p>
        )}
        {found && (
          <div className="gv-step-context-code">
            <span className="gv-step-context-label">
              {found.ai ? (
                <>
                  <span className="gv-ai-pill">AI</span> {copy.flows.aiEvidence}
                </>
              ) : (
                copy.flows.callSite
              )}
            </span>
            <CodeViewer
              key={`${found.evidence.file}:${String(found.evidence.line)}`}
              file={found.evidence.file}
              start={found.evidence.line}
              end={found.evidence.line}
              highlightLine={found.evidence.line}
              cacheKey={`${found.evidence.file}:${fromNode?.contentHash ?? ""}`}
              context={3}
            />
          </div>
        )}
      </section>
    </div>
  );
}

/** Flows containing this node, with the step number; a click opens that flow at that step. */
export function FlowsThroughHere({ model, node }: { model: Model; node: ModelNode }) {
  const refs = model.flows.flowsThroughNode.get(node.id) ?? [];
  if (refs.length === 0) return null;
  return (
    <section className="gv-insp-section" aria-label={copy.flows.flowsThroughHere}>
      <h3 className="gv-insp-heading">
        {copy.flows.flowsThroughHere}
        <span className="gv-insp-count">{refs.length}</span>
      </h3>
      <ul className="gv-insp-list">
        {refs.map((ref) => {
          const flow = model.flows.flowsById.get(ref.flowId);
          if (!flow) return null;
          return (
            <li key={`${ref.flowId}|${ref.stepId}`}>
              <button
                type="button"
                className="gv-link"
                onClick={() => {
                  const app = useAppStore.getState();
                  app.selectFlow(flow.id, "flow");
                  app.setActiveTab("flows");
                  const flows = useFlowsStore.getState();
                  flows.usePlaybackOf(flow.id);
                  flows.jump(flow, ref.stepId);
                }}
              >
                {flow.name}
              </button>
              <span className="gv-insp-dim"> · step {ref.index + 1}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** "Trace from here": the deterministic call tree from this function or class. */
export function TraceFromHere({ node }: { node: ModelNode }) {
  if (node.kind !== "function" && node.kind !== "class" && node.kind !== "file") return null;
  return (
    <button
      type="button"
      className="gv-link"
      onClick={() => {
        useFlowsStore.getState().traceFromHere(node.id);
      }}
    >
      {copy.flows.traceFromHere}
    </button>
  );
}
