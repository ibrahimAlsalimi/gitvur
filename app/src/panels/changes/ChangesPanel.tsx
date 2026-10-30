import { CHANGE_GLYPH, changeTitle } from "../../canvas/change";
import type { Model, ModelNode } from "../../model/buildModel";
import { ancestors } from "../../model/tree";
import { useAppStore } from "../../store/useAppStore";

interface FileGroup {
  file: ModelNode | undefined;
  items: ModelNode[];
}

interface ModuleGroup {
  module: ModelNode | undefined;
  files: FileGroup[];
}

/** Steps grouped by module → file, keeping step order. */
function group(model: Model, steps: readonly string[]): ModuleGroup[] {
  const modules: ModuleGroup[] = [];
  for (const id of steps) {
    const node = model.nodes.get(id);
    if (!node) continue;
    const chain = ancestors(model, id).map((a) => model.nodes.get(a));
    const module = chain.find((n) => n?.kind === "module");
    const file = node.kind === "file" ? node : chain.find((n) => n?.kind === "file");
    let m = modules.find((g) => g.module?.id === module?.id);
    if (!m) {
      m = { module, files: [] };
      modules.push(m);
    }
    let f = m.files.find((g) => g.file?.id === file?.id);
    if (!f) {
      f = { file, items: [] };
      m.files.push(f);
    }
    f.items.push(node);
  }
  return modules;
}

/** Replaces the explorer in the Changes lens: summary, then changes by module and file. */
export function ChangesPanel() {
  const diff = useAppStore((s) => s.diff);
  const model = useAppStore((s) => s.model);
  const selectedId = useAppStore((s) => s.selectedId);

  if (!diff || diff.status === "loading") {
    return (
      <p className="changes-empty" aria-busy="true">
        Comparing revisions…
      </p>
    );
  }
  if (diff.status === "error" || !diff.view || !model) {
    return (
      <div className="changes-empty" role="alert">
        <p>{diff.error?.message ?? "Cannot compare these revisions."}</p>
        {diff.error?.detail !== undefined && <p className="changes-detail">{diff.error.detail}</p>}
      </div>
    );
  }
  const { summary, steps, bundle } = diff.view;
  const edges = bundle.diff.summary;
  const groups = group(model, steps);
  return (
    <div className="changes">
      <div className="changes-summary" aria-label="Change summary">
        <span data-change="added">
          <b>+{summary.added}</b> added
        </span>
        <span data-change="modified">
          <b>~{summary.modified}</b> modified
        </span>
        <span data-change="removed">
          <b>−{summary.removed}</b> removed
        </span>
        <span data-change="moved">
          <b>→{summary.moved}</b> moved
        </span>
        <span className="changes-edges">
          relationships +{edges.edgesAdded} −{edges.edgesRemoved}
        </span>
      </div>
      {steps.length === 0 ? (
        <p className="changes-empty">No structural changes between these revisions.</p>
      ) : (
        <>
          <p className="changes-hint">
            <kbd>N</kbd> next · <kbd>Shift</kbd>+<kbd>N</kbd> previous
          </p>
          <ul className="changes-list" aria-label="Changes">
            {groups.map((m) => (
              <li key={m.module?.id ?? "none"} className="changes-module">
                <div className="changes-module-name">{m.module?.name ?? "No module"}</div>
                <ul>
                  {m.files.map((f) => (
                    <li key={f.file?.id ?? "none"} className="changes-file">
                      <div className="changes-file-name">
                        {f.file?.source?.file ?? f.file?.name}
                      </div>
                      <ul>
                        {f.items.map((node) => {
                          const kind = node.change?.change ?? "unchanged";
                          return (
                            <li key={node.id}>
                              <button
                                type="button"
                                className="changes-row"
                                aria-current={node.id === selectedId ? "true" : undefined}
                                title={changeTitle(node)}
                                onClick={() => {
                                  useAppStore.getState().navigateTo(node.id);
                                }}
                              >
                                {kind !== "unchanged" && (
                                  <span
                                    className="gv-insp-change-glyph"
                                    data-change={kind}
                                    aria-hidden="true"
                                  >
                                    {CHANGE_GLYPH[kind]}
                                  </span>
                                )}
                                <span className="changes-row-name" data-change={kind}>
                                  {node.name}
                                </span>
                                <span className="changes-row-kind">
                                  {kind === "moved"
                                    ? changeTitle(node).toLowerCase()
                                    : `${node.kind} · ${kind}`}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
