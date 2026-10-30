import type { ReactNode } from "react";

import { MapCanvas } from "../canvas/MapCanvas";
import { copy } from "../copy";
import type { AppError } from "../generated/contract";
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

/** The backend's own text, behind a disclosure. */
function Details({ error }: { error: AppError }) {
  const detail = [error.message, error.detail].filter(Boolean).join("\n");
  return (
    <details className="state-details">
      <summary>{copy.states.details}</summary>
      <pre className="state-detail">{detail}</pre>
    </details>
  );
}

function ErrorState({ error }: { error: AppError }) {
  const store = useAppStore.getState();
  const lostRemoved = useAppStore((s) => s.lostRemoved);
  const text = copy.errors[error.code];
  const action =
    error.code === "no-gitvur" || error.code === "schema-invalid" || error.code === "path-escape"
      ? () => void store.index()
      : error.code === "io" || error.code === "index-failed"
        ? () => {
            const { path } = useAppStore.getState();
            if (path !== null) void store.open(path);
          }
        : () => void store.chooseAndOpen();
  return (
    <StatePanel
      tone={error.code === "no-gitvur" ? "neutral" : "danger"}
      icon={
        error.code === "no-gitvur" ? (
          <FolderIcon className="state-icon" />
        ) : (
          <AlertIcon className="state-icon" />
        )
      }
      title={text.title}
      text={
        <>
          {text.text}
          {error.code === "not-a-directory" && lostRemoved && ` ${copy.states.lostRemoved}`}
        </>
      }
    >
      {error.code !== "no-gitvur" && <Details error={error} />}
      <div className="state-actions">
        <button type="button" className="button button-primary" onClick={action}>
          {text.action}
        </button>
        {error.code !== "not-a-directory" && (
          <button type="button" className="button" onClick={() => void store.chooseAndOpen()}>
            {copy.errors["not-a-directory"].action}
          </button>
        )}
      </div>
    </StatePanel>
  );
}

/** The centre pane: the map, or the app's state when there is no map to show. */
export function Canvas() {
  const phase = useAppStore((s) => s.phase);
  const error = useAppStore((s) => s.error);
  const bundle = useAppStore((s) => s.bundle);
  const model = useAppStore((s) => s.model);
  const recent = useAppStore((s) => s.recent);
  const store = useAppStore.getState();

  let content: ReactNode;
  if (phase === "opening" || phase === "indexing" || phase === "validating") {
    const title = copy.states.busy[phase];
    const files = model?.totals.files;
    content = (
      <StatePanel
        icon={
          // No file count is reported while working, so the bar is indeterminate.
          <div className="progress-bar" role="progressbar" aria-label={title}>
            <span />
          </div>
        }
        title={title}
        text={files !== undefined ? copy.states.busy.lastIndex(files) : copy.states.busy.noCount}
      />
    );
  } else if (phase === "error" && error) {
    content = <ErrorState error={error} />;
  } else if (phase === "ready" && model && model.totals.files === 0) {
    content = (
      <StatePanel
        icon={<FolderIcon className="state-icon" />}
        title={copy.states.noFiles.title}
        text={copy.states.noFiles.text}
      >
        <div className="state-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() => void store.chooseAndOpen()}
          >
            {copy.states.noFiles.action}
          </button>
        </div>
      </StatePanel>
    );
  } else if (phase === "ready" && model) {
    const notice =
      bundle?.annotations === null ? (
        <div className="canvas-notice">
          <StatePanel
            icon={<DocIcon className="state-icon" />}
            title={copy.states.noDescriptions.title}
            text={copy.states.noDescriptions.text}
          >
            <div className="state-actions">
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  store.setHelpOpen(true);
                }}
              >
                {copy.states.noDescriptions.action}
              </button>
            </div>
          </StatePanel>
        </div>
      ) : null;
    content = (
      <>
        <MapCanvas />
        {notice}
      </>
    );
  } else {
    content = (
      <StatePanel
        icon={<FolderIcon className="state-icon" />}
        title={copy.states.empty.title}
        text={copy.states.empty.text}
      >
        <div className="state-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() => void store.chooseAndOpen()}
          >
            {copy.states.empty.action}
          </button>
        </div>
        {recent.length > 0 && (
          <nav className="recent" aria-labelledby="recent-title">
            <h2 className="recent-title" id="recent-title">
              {copy.states.empty.recent}
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
