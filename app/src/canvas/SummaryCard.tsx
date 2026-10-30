import { Panel } from "@xyflow/react";

import type { Status } from "../generated/contract";
import { useAppStore } from "../store/useAppStore";

const SEGMENTS: { status: Status; label: string }[] = [
  { status: "documented", label: "documented" },
  { status: "stale", label: "stale" },
  { status: "undocumented", label: "undocumented" },
];

/**
 * Documentation lens summary (top-right): a stacked bar of documented / stale /
 * undocumented across the repository, with counts and the error count. Each segment
 * filters the explorer to those elements; activating it again clears the filter.
 */
export function SummaryCard() {
  const totals = useAppStore((s) => s.model?.totals);
  const filter = useAppStore((s) => s.statusFilter);
  if (!totals) return null;
  const total = totals.documented + totals.stale + totals.undocumented;
  const toggle = (status: Status) => {
    useAppStore.getState().setStatusFilter(filter === status ? null : status);
  };
  return (
    <Panel
      position="top-right"
      className="gv-summary"
      role="region"
      aria-label="Documentation summary"
    >
      <div className="gv-summary-title">Documentation</div>
      <div className="gv-summary-bar" role="group" aria-label="Filter the explorer by status">
        {SEGMENTS.map(({ status, label }) =>
          totals[status] > 0 ? (
            <button
              key={status}
              type="button"
              className="gv-summary-segment"
              data-status={status}
              aria-pressed={filter === status}
              aria-label={`Show ${String(totals[status])} ${label} in the explorer`}
              title={`${String(totals[status])} ${label}`}
              style={{ flexGrow: totals[status] }}
              onClick={() => {
                toggle(status);
              }}
            />
          ) : null,
        )}
      </div>
      <ul className="gv-summary-counts">
        {SEGMENTS.map(({ status, label }) => (
          <li key={status}>
            <button
              type="button"
              className="gv-summary-count"
              aria-pressed={filter === status}
              disabled={totals[status] === 0}
              onClick={() => {
                toggle(status);
              }}
            >
              <span className="status-dot" data-status={status} aria-hidden="true" />
              <strong>{totals[status]}</strong> {label}
              <span className="gv-summary-pct">
                {total === 0 ? "" : `${String(Math.round((totals[status] / total) * 100))}%`}
              </span>
            </button>
          </li>
        ))}
        {totals.errors > 0 && (
          <li>
            <button
              type="button"
              className="gv-summary-count"
              onClick={() => {
                useAppStore.getState().setIssuesOpen(true);
              }}
            >
              <span className="gv-error-dot" aria-hidden="true" />
              <strong>{totals.errors}</strong> {totals.errors === 1 ? "error" : "errors"}
            </button>
          </li>
        )}
      </ul>
    </Panel>
  );
}
