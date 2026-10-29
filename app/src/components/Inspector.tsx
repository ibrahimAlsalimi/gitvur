import { useAppStore } from "../store/useAppStore";
import { PanelIcon } from "./Icons";

const KIND_LABEL = {
  project: "Project",
  module: "Module",
  file: "File",
  class: "Class",
  function: "Function",
} as const;
const STATUS_LABEL = {
  documented: "Documented",
  stale: "Out of date",
  undocumented: "No description",
} as const;

/** Details of the selected element. Phase 08 adds source and relationships. */
export function Inspector() {
  const model = useAppStore((s) => s.model);
  const bundle = useAppStore((s) => s.bundle);
  const selectedId = useAppStore((s) => s.selectedId);
  const node = selectedId !== null ? model?.nodes.get(selectedId) : undefined;
  const stats = node?.kind === "module" ? model?.moduleStats.get(node.id) : undefined;

  return (
    <aside className="pane" aria-label="Inspector">
      <div className="pane-header">
        <span>Inspector</span>
        <button
          type="button"
          className="button button-icon button-ghost"
          aria-label="Collapse inspector"
          onClick={() => {
            useAppStore.getState().setInspectorCollapsed(true);
          }}
        >
          <PanelIcon side="close" />
        </button>
      </div>
      <div className="pane-body">
        {node ? (
          <div className="inspector-body">
            <div>
              <h2 className="inspector-title">{node.name}</h2>
              <div className="inspector-id">{node.id}</div>
            </div>
            <p className="inspector-description" data-empty={node.description === undefined}>
              {node.description ?? "No description yet."}
            </p>
            <dl className="facts">
              <dt>Kind</dt>
              <dd>{KIND_LABEL[node.kind]}</dd>
              {!node.synthetic && (
                <>
                  <dt>Status</dt>
                  <dd>
                    <span className="status-label">
                      <span
                        className="status-dot"
                        data-status={node.docStatus}
                        aria-hidden="true"
                      />
                      {STATUS_LABEL[node.docStatus]}
                      {node.docStatus === "stale" && node.childChanged ? " (a child changed)" : ""}
                    </span>
                  </dd>
                </>
              )}
              {node.source && (
                <>
                  <dt>Source</dt>
                  <dd>
                    <span className="inline-code">
                      {node.source.file}:{node.source.startLine}–{node.source.endLine}
                    </span>
                  </dd>
                </>
              )}
              {stats && (
                <>
                  <dt>Contents</dt>
                  <dd>
                    {stats.files} files · {stats.classes} classes · {stats.functions} functions
                  </dd>
                  <dt>Documented</dt>
                  <dd>{stats.documentedPct}%</dd>
                </>
              )}
            </dl>
          </div>
        ) : (
          <div className="inspector-body">
            <p className="inspector-description" data-empty="true">
              {model ? "Select an element to see its details." : "Nothing selected."}
            </p>
            {bundle && bundle.warnings.length > 0 && (
              <ul className="warning-list" aria-label="Warnings">
                {bundle.warnings.map((w) => (
                  <li key={w.code} className="warning-item">
                    {w.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

export function InspectorRail() {
  return (
    <div className="inspector-rail">
      <button
        type="button"
        className="button button-icon button-ghost"
        aria-label="Expand inspector"
        onClick={() => {
          useAppStore.getState().setInspectorCollapsed(false);
        }}
      >
        <PanelIcon side="open" />
      </button>
    </div>
  );
}
