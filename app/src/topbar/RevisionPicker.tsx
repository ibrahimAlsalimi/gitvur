import type { CommitInfo } from "../generated/contract";
import { WORKTREE, useAppStore } from "../store/useAppStore";

const label = (c: CommitInfo) =>
  `${c.short} ${c.subject.length > 48 ? `${c.subject.slice(0, 47)}…` : c.subject}`;

/** `from [commit ▾] → to [commit ▾]` for the Changes lens; `to` can be the working tree. */
export function RevisionPicker() {
  const lens = useAppStore((s) => s.lens);
  const commits = useAppStore((s) => s.commits);
  const diff = useAppStore((s) => s.diff);
  if (lens !== "changes" || !diff || commits.length === 0) return null;
  const load = (from: string, to: string) => void useAppStore.getState().loadDiff(from, to);
  return (
    <div className="revision-picker" role="group" aria-label="Revisions to compare">
      <label>
        <span className="revision-label">from</span>
        <select
          value={diff.from}
          onChange={(e) => {
            load(e.target.value, diff.to);
          }}
        >
          {commits.map((c) => (
            <option key={c.sha} value={c.sha}>
              {label(c)}
            </option>
          ))}
        </select>
      </label>
      <span aria-hidden="true">→</span>
      <label>
        <span className="revision-label">to</span>
        <select
          value={diff.to}
          onChange={(e) => {
            load(diff.from, e.target.value);
          }}
        >
          <option value={WORKTREE}>Working tree</option>
          {commits.map((c) => (
            <option key={c.sha} value={c.sha}>
              {label(c)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
