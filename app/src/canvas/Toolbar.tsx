import { Panel, useReactFlow } from "@xyflow/react";

import { type Lens, useAppStore } from "../store/useAppStore";

/** Floating canvas controls (top-left). */
export function Toolbar() {
  const rf = useReactFlow();
  const lens = useAppStore((s) => s.lens);
  const hops = useAppStore((s) => s.hops);
  const store = useAppStore.getState();
  return (
    <Panel position="top-left" className="gv-toolbar" aria-label="Map controls">
      <button
        type="button"
        className="gv-tool"
        onClick={() => {
          useAppStore.getState().requestFit();
        }}
        title="Fit the map to the window (F)"
      >
        Fit
      </button>
      <button
        type="button"
        className="gv-tool gv-tool-icon"
        aria-label="Zoom in"
        title="Zoom in (+)"
        onClick={() => void rf.zoomIn({ duration: 120 })}
      >
        +
      </button>
      <button
        type="button"
        className="gv-tool gv-tool-icon"
        aria-label="Zoom out"
        title="Zoom out (−)"
        onClick={() => void rf.zoomOut({ duration: 120 })}
      >
        −
      </button>
      <span className="gv-tool-divider" aria-hidden="true" />
      <button
        type="button"
        className="gv-tool"
        onClick={() => {
          store.expandAllFiles();
        }}
      >
        Expand all
      </button>
      <button
        type="button"
        className="gv-tool"
        onClick={() => {
          store.collapseAllFiles();
        }}
      >
        Collapse all
      </button>
      <span className="gv-tool-divider" aria-hidden="true" />
      <div className="gv-segmented" role="group" aria-label="Relationship depth">
        {([1, 2] as const).map((h) => (
          <button
            key={h}
            type="button"
            className="gv-tool"
            aria-pressed={hops === h}
            onClick={() => {
              store.setHops(h);
            }}
          >
            {h}-hop
          </button>
        ))}
      </div>
      <span className="gv-tool-divider" aria-hidden="true" />
      <label className="gv-tool-select" title="Lens (1 Structure, 2 Documentation, 3 Changes)">
        <span className="visually-hidden">Lens</span>
        <select
          value={lens}
          onChange={(e) => {
            store.setLens(e.target.value as Lens);
          }}
        >
          <option value="structure">Structure</option>
          <option value="coverage">Documentation</option>
          <option value="changes">Changes</option>
        </select>
      </label>
    </Panel>
  );
}
