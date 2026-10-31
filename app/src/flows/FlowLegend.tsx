import { copy } from "../copy";
import { useFlowsStore } from "./useFlowsStore";

const PROVENANCE = [
  { prov: "syntactic", label: "From code", hint: "found by the parser" },
  { prov: "semantic", label: "Semantic", hint: "found by a type-aware indexer" },
  { prov: "ai", label: "AI", hint: "written by the documenting agent, with evidence" },
] as const;

const KINDS = [
  { kind: "call", label: "calls" },
  { kind: "return", label: "returns" },
  { kind: "event", label: "event" },
  { kind: "async", label: "async" },
  { kind: "branch", label: "branch" },
] as const;

const MARKER = { call: "arrow", event: "arrow", branch: "arrow", return: "open", async: "chevron" };

/** Line pattern = provenance, marker = kind. Rendered with the real styles; collapsible. */
export function FlowLegend() {
  const open = useFlowsStore((s) => s.legendOpen);
  const setOpen = (legendOpen: boolean) => {
    useFlowsStore.setState({ legendOpen });
  };
  return (
    <div className="gv-legend gv-flow-legend" aria-label={copy.flows.legend} role="group">
      <button
        type="button"
        className="gv-legend-toggle"
        aria-expanded={open}
        data-export="skip"
        onClick={() => {
          setOpen(!open);
        }}
      >
        {copy.flows.legend}
      </button>
      {open && (
        <ul className="gv-legend-list">
          {PROVENANCE.map((r) => (
            <li key={r.prov} className="gv-legend-row" title={r.hint}>
              <svg className="gv-legend-sample" viewBox="0 0 44 12" aria-hidden="true">
                <g className="gv-flow-edge" data-prov={r.prov} data-kind="call">
                  <path
                    className="gv-flow-edge-line"
                    d="M 2 6 L 40 6"
                    markerEnd={`url(#gv-flow-arrow-${r.prov})`}
                  />
                </g>
              </svg>
              <span>{r.label}</span>
              {r.prov === "ai" && <span className="gv-ai-pill">AI</span>}
            </li>
          ))}
          {KINDS.map((k) => (
            <li key={k.kind} className="gv-legend-row">
              <svg className="gv-legend-sample" viewBox="0 0 44 12" aria-hidden="true">
                <g className="gv-flow-edge" data-prov="syntactic" data-kind={k.kind}>
                  {k.kind === "branch" && (
                    <path className="gv-flow-diamond" d="M 6 1 l 5 5 l -5 5 l -5 -5 z" />
                  )}
                  <path
                    className="gv-flow-edge-line"
                    d={k.kind === "branch" ? "M 11 6 L 40 6" : "M 2 6 L 40 6"}
                    markerEnd={`url(#gv-flow-${MARKER[k.kind]}-syntactic)`}
                  />
                </g>
              </svg>
              <span>
                {k.kind === "event" ? "⚡ " : k.kind === "async" ? "⏵⏵ " : ""}
                {k.label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
