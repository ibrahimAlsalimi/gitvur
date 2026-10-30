import type { ModelNode } from "../model/buildModel";
import { CHANGE_GLYPH, changeTitle } from "./change";

/**
 * The change glyph shown in the status slot in the Changes lens (CSS hides it elsewhere):
 * `+ − ~ →`, or a hollow ring when only a child changed. Colour and glyph both, so it
 * reads in greyscale.
 */
export function ChangeMark({ node }: { node: ModelNode }) {
  const c = node.change;
  if (!c || c.change === "unchanged") return null;
  const title = changeTitle(node);
  if (c.change === "modified" && c.childChanged) {
    return (
      <span
        className="gv-change-mark"
        data-change="child"
        title={title}
        role="img"
        aria-label={title}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className="gv-mark">
          <circle
            cx="8"
            cy="8"
            r="3.75"
            fill="none"
            stroke="var(--gv-diff-modified)"
            strokeWidth="1.75"
          />
        </svg>
      </span>
    );
  }
  return (
    <span
      className="gv-change-mark"
      data-change={c.change}
      title={title}
      role="img"
      aria-label={title}
    >
      {CHANGE_GLYPH[c.change]}
    </span>
  );
}
