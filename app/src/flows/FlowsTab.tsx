import { type CSSProperties, useEffect } from "react";

import { copy } from "../copy";
import { ResizeHandle } from "../components/ResizeHandle";
import { Inspector, InspectorRail } from "../inspector/Inspector";
import { StepContext } from "../inspector/FlowSections";
import { PANE_LIMITS, useAppStore } from "../store/useAppStore";
import { FlowCanvas } from "./FlowCanvas";
import { filterEntries } from "./filterEntries";
import { FlowList } from "./FlowList";
import { subjectOf } from "./subject";
import { useFlowsStore } from "./useFlowsStore";

/** The Flows tab: entry points and flows | Flow or Trace canvas | inspector with step context. */
export function FlowsTab() {
  const active = useAppStore((s) => s.activeTab === "flows");
  const model = useAppStore((s) => s.model);
  const selection = useAppStore((s) => s.flowSelection);
  const inspectorWidth = useAppStore((s) => s.settings.inspectorWidth);
  const collapsed = useAppStore((s) => s.settings.inspectorCollapsed);
  const traceFrom = useFlowsStore((s) => s.traceFrom);

  // First visit: open the first flow, or the first entry point's call tree.
  useEffect(() => {
    if (!active || !model || selection !== null || traceFrom !== null) return;
    const first = filterEntries(model, "");
    const flow = first.find((g) => g.flows.length > 0)?.flows[0];
    const entry = model.flows.entryPoints[0];
    if (flow) useAppStore.getState().selectFlow(flow.id, "flow");
    else if (entry) useAppStore.getState().selectFlow(entry.id, "trace");
  }, [active, model, selection, traceFrom]);

  const subject = model ? subjectOf(model, selection, traceFrom) : undefined;
  const empty =
    model && model.flows.entryPoints.length === 0 && model.flows.flows.length === 0 && !traceFrom;
  return (
    <section
      id="panel-flows"
      role="tabpanel"
      aria-labelledby="tab-flows"
      className={`gv-flows-panel${active ? "" : " gv-tab-hidden"}`}
      inert={!active}
      data-inspector={collapsed ? "collapsed" : "open"}
      style={{ "--inspector-width": `${String(inspectorWidth)}px` } as CSSProperties}
    >
      {model && <FlowList model={model} />}
      <div className="gv-flows-center">
        {!model ? null : empty ? (
          <div className="gv-flow-empty">
            <p>{copy.flows.noEntries}</p>
            <button
              type="button"
              className="button"
              onClick={() => {
                useAppStore.getState().setActiveTab("map");
              }}
            >
              {copy.flows.noEntriesAction}
            </button>
          </div>
        ) : subject && (subject.flow || subject.traceStart) && active ? (
          <FlowCanvas model={model} subject={subject} />
        ) : model.flows.flows.length === 0 && model.flows.entryPoints[0] ? (
          <div className="gv-flow-empty">
            <p>{copy.flows.noFlows}</p>
            <button
              type="button"
              className="button"
              onClick={() => {
                const entry = model.flows.entryPoints[0];
                if (entry) useAppStore.getState().selectFlow(entry.id, "trace");
              }}
            >
              {copy.flows.noFlowsAction}
            </button>
          </div>
        ) : (
          <div className="gv-flow-empty">
            <p>{copy.flows.pickPrompt}</p>
          </div>
        )}
      </div>
      {collapsed ? (
        <InspectorRail />
      ) : (
        <>
          <ResizeHandle
            label="Resize inspector"
            value={inspectorWidth}
            min={PANE_LIMITS.inspector.min}
            max={PANE_LIMITS.inspector.max}
            direction={-1}
            onChange={(width) => {
              useAppStore.getState().setPane("inspector", width);
            }}
          />
          <Inspector top={model ? <StepContext model={model} /> : null} />
        </>
      )}
    </section>
  );
}
