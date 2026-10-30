import { useAppStore } from "../store/useAppStore";

/** `214 documented · 12 stale · 30 undocumented · 3 errors`, each with its status dot. */
export function TrustSummary() {
  const totals = useAppStore((s) => s.model?.totals);
  if (!totals) return null;
  const items = [
    { key: "documented", count: totals.documented, label: "documented" },
    { key: "stale", count: totals.stale, label: "stale" },
    { key: "undocumented", count: totals.undocumented, label: "undocumented" },
  ] as const;
  return (
    <div className="trust-summary" aria-label="Documentation status">
      {items.map((i) => (
        <span key={i.key} className="trust-item">
          <span className="status-dot" data-status={i.key} aria-hidden="true" />
          {i.count} {i.label}
        </span>
      ))}
      {totals.errors > 0 && (
        <button
          type="button"
          className="trust-item trust-errors"
          onClick={() => {
            useAppStore.getState().setIssuesOpen(true);
          }}
        >
          <span className="gv-error-dot" aria-hidden="true" />
          {totals.errors} {totals.errors === 1 ? "error" : "errors"}
        </button>
      )}
    </div>
  );
}
