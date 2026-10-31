import { copy } from "../copy";
import type { Flow, FlowStatus, Issue } from "../generated/contract";
import { useAppStore } from "../store/useAppStore";
import type { FlowView } from "./flowView";
import { FlowStatusMark } from "./glyphs";

/** Name, description, provenance summary, status, and the stale / broken banners. */
export function FlowHeader({
  flow,
  view,
  status,
  issues,
}: {
  flow: Flow;
  view: FlowView;
  status: FlowStatus | undefined;
  issues: Issue[];
}) {
  const state = status?.status ?? "current";
  const staleNumbers = view.steps.filter((s) => s.stale).map((s) => String(s.index + 1));
  return (
    <header className="gv-flow-header">
      <div className="gv-flow-title-row">
        <h2 className="gv-flow-title">{flow.name}</h2>
        <span className="gv-flow-badge" data-kind="flow">
          {copy.flows.flowBadge}
        </span>
      </div>
      {flow.description && <p className="gv-flow-description">{flow.description}</p>}
      <p className="gv-flow-summary">
        <span className="gv-flow-chip-summary">
          {copy.flows.summary(view.steps.length, view.fromCode, view.ai)}
        </span>
        <span className="gv-flow-state" data-state={state}>
          <FlowStatusMark status={state} />
          {copy.flows.status[state]}
        </span>
      </p>
      {state === "stale" && staleNumbers.length > 0 && (
        <p className="gv-flow-banner" data-kind="stale" role="status">
          {copy.flows.stale(staleNumbers.join(", "))}
        </p>
      )}
      {state === "broken" && (
        <div className="gv-flow-banner" data-kind="broken" role="alert">
          <p>{copy.flows.broken}</p>
          {issues.length > 0 && (
            <ul>
              {issues.map((issue) => (
                <li key={`${issue.code}|${issue.message}`}>
                  <code>{issue.code}</code> {issue.message}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="gv-link"
            onClick={() => {
              useAppStore.setState({ issuesOpen: true });
            }}
          >
            {copy.flows.showIssues}
          </button>
        </div>
      )}
    </header>
  );
}

/** Header for Trace mode. */
export function TraceHeader({
  title,
  subtitle,
  notice,
}: {
  title: string;
  subtitle: string | undefined;
  notice: string | undefined;
}) {
  return (
    <header className="gv-flow-header">
      <div className="gv-flow-title-row">
        <h2 className="gv-flow-title">{title}</h2>
        <span className="gv-flow-badge" data-kind="trace">
          {copy.flows.traceBadge}
        </span>
      </div>
      {subtitle && <p className="gv-flow-description">{subtitle}</p>}
      {notice && (
        <p className="gv-flow-banner" data-kind="info" role="status">
          {notice}
        </p>
      )}
    </header>
  );
}
