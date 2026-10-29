import { Panel } from "@xyflow/react";
import { useState } from "react";

const ROWS = [
  { prov: "syntactic", label: "Syntactic", hint: "found by the parser" },
  { prov: "semantic", label: "Semantic", hint: "found by a type-aware indexer" },
  { prov: "ai", label: "AI", hint: "written by the documenting agent" },
  { prov: "candidate", label: "Possible target", hint: "ambiguous call" },
] as const;

/** Provenance legend, drawn with the real line styles. Collapsible. */
export function Legend() {
  const [open, setOpen] = useState(true);
  return (
    <Panel position="bottom-left" className="gv-legend" aria-label="Legend">
      <button
        type="button"
        className="gv-legend-toggle"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
      >
        Relationships
      </button>
      {open && (
        <ul className="gv-legend-list">
          {ROWS.map((r) => (
            <li key={r.prov} className="gv-legend-row" title={r.hint}>
              <svg className="gv-legend-sample" viewBox="0 0 44 12" aria-hidden="true">
                <g className="gv-edge" data-prov={r.prov}>
                  <path
                    className="gv-edge-line"
                    d="M 2 6 L 40 6"
                    markerEnd={r.prov === "candidate" ? undefined : `url(#gv-arrow-${r.prov})`}
                  />
                </g>
              </svg>
              <span>{r.label}</span>
              {r.prov === "ai" && <span className="gv-ai-pill">AI</span>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
