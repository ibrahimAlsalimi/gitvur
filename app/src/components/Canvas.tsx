import type { ReactNode } from "react";

import { useAppStore } from "../store/useAppStore";
import { AlertIcon, DocIcon, FolderIcon } from "./Icons";

interface StatePanelProps {
  icon?: ReactNode;
  title: string;
  text: ReactNode;
  tone?: "neutral" | "danger";
  children?: ReactNode;
}

function StatePanel({ icon, title, text, tone = "neutral", children }: StatePanelProps) {
  return (
    <section className="state-panel" data-tone={tone} aria-labelledby="state-title">
      {icon}
      <h1 className="state-title" id="state-title">
        {title}
      </h1>
      <p className="state-text">{text}</p>
      {children}
    </section>
  );
}

/** The centre pane. Phase 07 draws the map here; until then it shows the app state. */
export function Canvas() {
  const phase = useAppStore((s) => s.phase);
  const error = useAppStore((s) => s.error);
  const bundle = useAppStore((s) => s.bundle);
  const model = useAppStore((s) => s.model);
  const recent = useAppStore((s) => s.recent);
  const selectedId = useAppStore((s) => s.selectedId);
  const store = useAppStore.getState();

  let content: ReactNode;
  if (phase === "opening" || phase === "indexing" || phase === "validating") {
    const verb = { opening: "Opening", indexing: "Indexing", validating: "Validating" }[phase];
    const files = model?.totals.files;
    content = (
      <StatePanel
        icon={<div className="spinner" role="progressbar" aria-label={`${verb}…`} />}
        title={`${verb}…`}
        text={
          files !== undefined
            ? `${String(files)} files in the last index.`
            : "This can take a few seconds on a large repository."
        }
      />
    );
  } else if (phase === "error" && error?.code === "no-gitvur") {
    content = (
      <StatePanel
        icon={<FolderIcon className="state-icon" />}
        title="This repository hasn't been indexed yet"
        text="Indexing reads the code and writes its structure to a .gitvur folder. Nothing is executed."
      >
        <div className="state-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() => void store.index()}
          >
            Index now
          </button>
          <button type="button" className="button" onClick={() => void store.chooseAndOpen()}>
            Open another
          </button>
        </div>
      </StatePanel>
    );
  } else if (phase === "error" && error?.code === "schema-invalid") {
    content = (
      <StatePanel
        tone="danger"
        icon={<AlertIcon className="state-icon" />}
        title=".gitvur/ files don't match the expected format"
        text="They may come from another version of Gitvur. Re-indexing rewrites the structure; descriptions are kept."
      >
        {error.detail && <pre className="state-detail">{error.detail}</pre>}
        <div className="state-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() => void store.index()}
          >
            Re-index
          </button>
        </div>
      </StatePanel>
    );
  } else if (phase === "error" && error) {
    content = (
      <StatePanel
        tone="danger"
        icon={<AlertIcon className="state-icon" />}
        title="Couldn't open this folder"
        text={error.message}
      >
        {error.detail && <pre className="state-detail">{error.detail}</pre>}
        <div className="state-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() => void store.chooseAndOpen()}
          >
            Open another repository
          </button>
        </div>
      </StatePanel>
    );
  } else if (phase === "ready" && bundle && bundle.annotations === null) {
    content = (
      <StatePanel
        icon={<DocIcon className="state-icon" />}
        title="Structure loaded — no descriptions yet"
        text="Browse files, classes and functions in the explorer. A documenting agent adds modules and descriptions."
      >
        <div className="state-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              store.setHelpOpen(true);
            }}
          >
            Show how to document
          </button>
        </div>
      </StatePanel>
    );
  } else if (phase === "ready" && model) {
    const selected = selectedId !== null ? model.nodes.get(selectedId) : undefined;
    content = (
      <div className="canvas-placeholder">
        <strong>Map view</strong>
        <span>
          {selected ? `Selected: ${selected.name}` : "Select an element in the explorer."}
        </span>
      </div>
    );
  } else {
    content = (
      <StatePanel
        icon={<FolderIcon className="state-icon" />}
        title="Open a repository to map it"
        text="Gitvur shows a repository as a map of modules, files, classes and functions. It never changes your code."
      >
        <div className="state-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() => void store.chooseAndOpen()}
          >
            Open repository
          </button>
        </div>
        {recent.length > 0 && (
          <nav className="recent" aria-labelledby="recent-title">
            <h2 className="recent-title" id="recent-title">
              Recent
            </h2>
            <ul className="recent-list">
              {recent.slice(0, 5).map((r) => (
                <li key={r.path}>
                  <button
                    type="button"
                    className="recent-item"
                    onClick={() => void store.open(r.path)}
                  >
                    <span>{r.name}</span>
                    <span className="recent-path">{r.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </StatePanel>
    );
  }

  return (
    <main className="canvas" aria-label="Map">
      {content}
    </main>
  );
}
