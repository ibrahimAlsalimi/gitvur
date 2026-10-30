import { useState } from "react";

import { middleTruncate } from "../../canvas/text";
import { SeverityIcon } from "../../components/SeverityIcon";
import type { Issue } from "../../generated/contract";
import type { Model } from "../../model/buildModel";
import { useAppStore } from "../../store/useAppStore";

interface Group {
  code: string;
  severity: Issue["severity"];
  issues: Issue[];
}

/** Groups by code, keeping the model's order (errors first, then by code). */
function groupIssues(issues: readonly Issue[]): Group[] {
  const groups = new Map<string, Group>();
  for (const issue of issues) {
    const key = `${issue.severity}|${issue.code}`;
    const group = groups.get(key);
    if (group) group.issues.push(issue);
    else groups.set(key, { code: issue.code, severity: issue.severity, issues: [issue] });
  }
  return [...groups.values()];
}

function IssueRow({ model, issue }: { model: Model; issue: Issue }) {
  const target = issue.id !== undefined && model.nodes.has(issue.id) ? issue.id : undefined;
  const content = (
    <>
      <SeverityIcon severity={issue.severity} />
      <span className="issue-message">{issue.message}</span>
      {issue.id !== undefined && (
        <span className="issue-id" title={issue.id}>
          {middleTruncate(issue.id, 56)}
        </span>
      )}
    </>
  );
  return (
    <li>
      {target !== undefined ? (
        <button
          type="button"
          className="issue-row"
          onClick={() => {
            useAppStore.getState().navigateTo(target);
          }}
        >
          {content}
        </button>
      ) : (
        <div
          className="issue-row"
          data-static="true"
          title={issue.id !== undefined ? "This element is not in the map" : undefined}
        >
          {content}
        </div>
      )}
    </li>
  );
}

/** Bottom drawer listing the validator's issues; a row selects and centres its element. */
export function IssuesPanel() {
  const model = useAppStore((s) => s.model);
  const hasReport = useAppStore((s) => s.bundle?.report != null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  if (!model) return null;
  const groups = groupIssues(model.issues);
  const { errors, warnings } = model.totals;
  const toggle = (key: string) => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCollapsed(next);
  };
  return (
    <section className="issues-panel" aria-label="Issues panel">
      <div className="issues-header">
        <h2 className="issues-title">Validation issues</h2>
        <span className="issues-counts">
          {errors} {errors === 1 ? "error" : "errors"} · {warnings}{" "}
          {warnings === 1 ? "warning" : "warnings"}
        </span>
        <span className="issues-hint">Ctrl+Shift+M</span>
        <button
          type="button"
          className="button button-icon button-ghost"
          aria-label="Close issues panel"
          onClick={() => {
            useAppStore.getState().setIssuesOpen(false);
          }}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
      </div>
      <div className="issues-body">
        {groups.length === 0 ? (
          <p className="issues-empty">
            {hasReport ? "No validation issues." : "Not validated yet."}
          </p>
        ) : (
          groups.map((g) => {
            const key = `${g.severity}|${g.code}`;
            const open = !collapsed.has(key);
            return (
              <div key={key} className="issues-group">
                <button
                  type="button"
                  className="issues-group-header"
                  aria-expanded={open}
                  onClick={() => {
                    toggle(key);
                  }}
                >
                  <svg
                    viewBox="0 0 16 16"
                    className="gv-glyph gv-chevron"
                    data-expanded={open}
                    aria-hidden="true"
                  >
                    <path d="m6 4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  </svg>
                  <SeverityIcon severity={g.severity} />
                  <code className="inline-code">{g.code}</code>
                  <span className="issues-group-count">{g.issues.length}</span>
                </button>
                {open && (
                  <ul className="issues-list">
                    {g.issues.map((issue) => (
                      <IssueRow
                        key={`${issue.id ?? ""}|${issue.message}`}
                        model={model}
                        issue={issue}
                      />
                    ))}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
