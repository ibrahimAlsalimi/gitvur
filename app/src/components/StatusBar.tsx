import { useDocsStore } from "../docs/useDocsStore";
import { copy } from "../copy";
import { useAppStore } from "../store/useAppStore";
import { SeverityIcon } from "./SeverityIcon";

/** `2026-10-29T21:24:07Z` → `2026-10-29 21:24 UTC` (timezone-independent). */
function formatIndexedAt(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  const [, date, time] = match ?? [];
  return date !== undefined && time !== undefined ? `${date} ${time} UTC` : iso;
}

export function StatusBar() {
  const indexingDocs = useDocsStore((s) => s.indexing);
  const model = useAppStore((s) => s.model);
  const bundle = useAppStore((s) => s.bundle);
  const issuesOpen = useAppStore((s) => s.issuesOpen);
  if (!model || !bundle) {
    return <footer className="statusbar">Ready</footer>;
  }
  const t = model.totals;
  const warnings = bundle.warnings;
  return (
    <footer className="statusbar">
      <span className="statusbar-item">{t.files} files</span>
      <span className="statusbar-item">{t.nodes} nodes</span>
      <span className="statusbar-item">{t.edges} edges</span>
      <span className="statusbar-item">{t.documentedPct}% documented</span>
      {indexingDocs && (
        <span className="statusbar-item" role="status">
          {copy.docs.indexing}
        </span>
      )}
      <span className="statusbar-spacer" />
      <button
        type="button"
        className="statusbar-item statusbar-issues"
        aria-expanded={issuesOpen}
        title="Validation issues (Ctrl+Shift+M)"
        onClick={() => {
          useAppStore.getState().setIssuesOpen(!issuesOpen);
        }}
      >
        <span className="statusbar-count" data-severity="error" data-zero={t.errors === 0}>
          <SeverityIcon severity="error" />
          {t.errors} {t.errors === 1 ? "error" : "errors"}
        </span>
        <span className="statusbar-count" data-severity="warning" data-zero={t.warnings === 0}>
          <SeverityIcon severity="warning" />
          {t.warnings} {t.warnings === 1 ? "warning" : "warnings"}
        </span>
      </button>
      {warnings.length > 0 && (
        <span
          className="statusbar-item statusbar-warning"
          title={warnings.map((w) => w.message).join("\n")}
        >
          {warnings.length} {warnings.length === 1 ? "warning" : "warnings"}
        </span>
      )}
      <span className="statusbar-item">Indexed {formatIndexedAt(bundle.manifest.generatedAt)}</span>
    </footer>
  );
}
