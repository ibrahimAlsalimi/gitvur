import { useAppStore } from "../store/useAppStore";

/** `2026-10-29T21:24:07Z` → `2026-10-29 21:24 UTC` (timezone-independent). */
function formatIndexedAt(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  const [, date, time] = match ?? [];
  return date !== undefined && time !== undefined ? `${date} ${time} UTC` : iso;
}

export function StatusBar() {
  const model = useAppStore((s) => s.model);
  const bundle = useAppStore((s) => s.bundle);
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
      <span className="statusbar-spacer" />
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
