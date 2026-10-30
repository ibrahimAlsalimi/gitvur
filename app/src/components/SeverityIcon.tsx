import type { Severity } from "../generated/contract";

/** Error: filled triangle. Warning: outlined circle with `!`. Shape differs, not just colour. */
export function SeverityIcon({ severity }: { severity: Severity }) {
  const label = severity === "error" ? "Error" : "Warning";
  return (
    <svg className="severity-icon" data-severity={severity} viewBox="0 0 16 16" role="img">
      <title>{label}</title>
      {severity === "error" ? (
        <>
          <path d="M8 2 14.5 13.5h-13Z" fill="var(--gv-status-error)" />
          <path d="M8 6.5v3.25" stroke="var(--gv-bg-surface)" strokeWidth="1.5" />
          <circle cx="8" cy="11.75" r="0.85" fill="var(--gv-bg-surface)" />
        </>
      ) : (
        <>
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="var(--gv-status-stale)"
            strokeWidth="1.5"
          />
          <path d="M8 4.75v3.75" stroke="var(--gv-status-stale)" strokeWidth="1.5" />
          <circle cx="8" cy="10.75" r="0.85" fill="var(--gv-status-stale)" />
        </>
      )}
    </svg>
  );
}
