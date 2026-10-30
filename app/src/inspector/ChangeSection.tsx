import { CHANGE_GLYPH, CHANGE_LABEL, countsLabel } from "../canvas/change";
import type { Node, SourceRange } from "../generated/contract";
import type { ModelNode } from "../model/buildModel";
import type { DiffView } from "../model/diffModel";
import { WORKTREE } from "../store/useAppStore";
import { CodeViewer } from "./CodeViewer";
import { SourceDiff } from "./SourceDiff";

const revLabel = (rev: string) => (rev === WORKTREE ? "the working tree" : rev.slice(0, 7));

const where = (r: SourceRange) =>
  `${r.file}:${String(r.startLine)}${r.endLine !== r.startLine ? `–${String(r.endLine)}` : ""}`;

/**
 * How the selected element changed between the two revisions, with its source: a diff for
 * modified elements, the old text for removed ones, and old and new locations for moves.
 */
export function ChangeSection({ node, view }: { node: ModelNode; view: DiffView }) {
  const c = node.change;
  if (!c) return null;
  const from = view.bundle.diff.fromCommit;
  const to = view.bundle.diff.toCommit;
  const oldNode = (id: string): Node | undefined => view.bundle.from.nodes.find((n) => n.id === id);

  if (node.kind === "module") {
    const label = c.counts ? countsLabel(c.counts) : "";
    return (
      <section className="gv-insp-section gv-insp-change" aria-label="Changes">
        <h3 className="gv-insp-heading">Changes</h3>
        <p className="gv-insp-change-line">
          {label === ""
            ? `Nothing changed between ${revLabel(from)} and ${revLabel(to)}.`
            : `${label} between ${revLabel(from)} and ${revLabel(to)}`}
        </p>
      </section>
    );
  }

  const kind = c.change;
  const childOnly = kind === "modified" && c.childChanged;
  const headline =
    kind === "unchanged"
      ? `Unchanged between ${revLabel(from)} and ${revLabel(to)}`
      : kind === "added"
        ? `Added in ${revLabel(to)}`
        : kind === "removed"
          ? `Removed in ${revLabel(to)}`
          : childOnly
            ? "Something inside changed"
            : CHANGE_LABEL[kind];
  const before =
    kind === "moved" && c.movedFrom !== undefined ? oldNode(c.movedFrom) : oldNode(node.id);
  const range = node.source;

  let source: React.ReactNode = null;
  if (kind === "modified" && before?.source && range) {
    source = (
      <SourceDiff
        key={node.id}
        before={{ range: before.source, rev: from }}
        after={{ range, rev: to }}
      />
    );
  } else if (range && node.kind !== "file") {
    source = (
      <CodeViewer
        key={`${node.id}@${kind === "removed" ? from : to}`}
        file={range.file}
        start={range.startLine}
        end={range.endLine}
        cacheKey={node.contentHash ?? node.id}
        rev={kind === "removed" ? from : to}
      />
    );
  }

  return (
    <section className="gv-insp-section gv-insp-change" aria-label="Changes">
      <h3 className="gv-insp-heading">Changes</h3>
      <p className="gv-insp-change-line" data-change={childOnly ? "child" : kind}>
        {kind !== "unchanged" && !childOnly && (
          <span className="gv-insp-change-glyph" data-change={kind} aria-hidden="true">
            {CHANGE_GLYPH[kind]}
          </span>
        )}
        <span>{headline}</span>
      </p>
      {kind === "moved" && before?.source && range && (
        <dl className="facts gv-insp-moved">
          <dt>From</dt>
          <dd className="inline-code">{where(before.source)}</dd>
          <dt>To</dt>
          <dd className="inline-code">{where(range)}</dd>
        </dl>
      )}
      {source}
    </section>
  );
}
