import type { ModelNode, ModuleStats } from "../model/buildModel";

const svg = { "aria-hidden": true, focusable: false } as const;

/** Plain-language status for titles and labels. */
function statusTitle(node: ModelNode): string {
  const parts: string[] = [];
  if (node.docStatus === "stale") {
    parts.push(
      node.childChanged === true && node.selfChanged !== true
        ? "Something inside changed since the description was written"
        : "Code changed since the description was written",
    );
  } else if (node.docStatus === "undocumented") {
    parts.push("No description");
  }
  const errors = node.issues.filter((i) => i.severity === "error").length;
  if (errors > 0) parts.push(`${String(errors)} validation ${errors === 1 ? "error" : "errors"}`);
  return parts.join(" · ");
}

/**
 * The 16px status slot on file cards and rows. Documented (and undocumented, in the
 * Structure lens) shows nothing; stale shows a dot (own code changed) or a ring (only a
 * child changed); a validation error shows a triangle, which takes precedence.
 */
export function StatusMark({ node }: { node: ModelNode }) {
  const hasError = node.issues.some((i) => i.severity === "error");
  const stale = node.docStatus === "stale";
  const childOnly = stale && node.childChanged === true && node.selfChanged !== true;
  const title = statusTitle(node);
  return (
    <span
      className="gv-status-slot"
      data-mark={hasError ? "error" : stale ? (childOnly ? "child" : "self") : "none"}
      title={title || undefined}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
    >
      {hasError ? (
        <svg {...svg} viewBox="0 0 16 16" className="gv-mark">
          <path d="M8 2.5 14 13H2Z" fill="var(--gv-status-error)" />
          <path d="M8 6.5v3" stroke="var(--gv-bg-surface-raised)" strokeWidth="1.5" />
          <circle cx="8" cy="11.25" r="0.85" fill="var(--gv-bg-surface-raised)" />
        </svg>
      ) : stale ? (
        <svg {...svg} viewBox="0 0 16 16" className="gv-mark">
          <circle
            cx="8"
            cy="8"
            r={childOnly ? 3.75 : 4.5}
            fill={childOnly ? "none" : "var(--gv-status-stale)"}
            stroke="var(--gv-status-stale)"
            strokeWidth={childOnly ? 1.75 : 0}
          />
        </svg>
      ) : null}
    </span>
  );
}

/** Documented / stale / undocumented arcs of a module's ring (documented starts at 12 o'clock). */
export function StatusRing({ stats }: { stats: ModuleStats }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  const total = stats.documented + stats.stale + stats.undocumented;
  const parts = [
    { key: "documented", value: stats.documented, color: "var(--gv-status-documented)" },
    { key: "stale", value: stats.stale, color: "var(--gv-status-stale)" },
    { key: "undocumented", value: stats.undocumented, color: "var(--gv-status-undocumented)" },
  ];
  let offset = 0;
  const label =
    total === 0
      ? "Empty module"
      : `${String(stats.documentedPct)}% documented, ${String(stats.stale)} stale, ${String(stats.undocumented)} undocumented`;
  return (
    <svg className="gv-ring" viewBox="0 0 18 18" role="img" aria-label={label}>
      <title>{label}</title>
      <circle cx="9" cy="9" r={r} fill="none" stroke="var(--gv-border-default)" strokeWidth="2.5" />
      {total > 0 &&
        parts.map((p) => {
          const length = (c * p.value) / total;
          const arc = (
            <circle
              key={p.key}
              data-part={p.key}
              cx="9"
              cy="9"
              r={r}
              fill="none"
              stroke={p.color}
              strokeWidth="2.5"
              strokeDasharray={`${String(length)} ${String(c)}`}
              strokeDashoffset={String(-offset)}
              transform="rotate(-90 9 9)"
            />
          );
          offset += length;
          return p.value > 0 ? arc : null;
        })}
    </svg>
  );
}
