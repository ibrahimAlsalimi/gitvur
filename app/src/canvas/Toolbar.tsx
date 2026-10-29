import { Panel, useReactFlow } from "@xyflow/react";

import { type Lens, useAppStore } from "../store/useAppStore";

const FIT = { padding: "48px", duration: 180 } as const;

/** Floating canvas controls (top-left). */
export function Toolbar() {
  const rf = useReactFlow();
  const lens = useAppStore((s) => s.lens);
  const store = useAppStore.getState();
  return (
    <Panel position="top-left" className="gv-toolbar" aria-label="Map controls">
      <button
        type="button"
        className="gv-tool"
        onClick={() => void rf.fitView(FIT)}
        title="Fit the map to the window"
      >
        Fit
      </button>
      <button
        type="button"
        className="gv-tool gv-tool-icon"
        aria-label="Zoom in"
        onClick={() => void rf.zoomIn({ duration: 120 })}
      >
        +
      </button>
      <button
        type="button"
        className="gv-tool gv-tool-icon"
        aria-label="Zoom out"
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
      <label className="gv-tool-select">
        <span className="visually-hidden">Lens</span>
        <select
          value={lens}
          onChange={(e) => {
            store.setLens(e.target.value as Lens);
          }}
        >
          <option value="structure">Structure</option>
        </select>
      </label>
    </Panel>
  );
}
