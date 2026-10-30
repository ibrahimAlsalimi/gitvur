import type { ChangeCounts, ModelNode } from "../model/buildModel";

/** `data-change` for a node in the Changes lens; `child` when only a child changed. */
export function changeAttr(node: ModelNode): string | undefined {
  const c = node.change;
  if (!c) return undefined;
  if (c.change === "modified" && c.childChanged) return "child";
  return c.change;
}

/** `+3 ~5 −1 →2`, leaving out zeros; empty when nothing changed. */
export function countsLabel(counts: ChangeCounts): string {
  return [
    counts.added > 0 ? `+${String(counts.added)}` : "",
    counts.modified > 0 ? `~${String(counts.modified)}` : "",
    counts.removed > 0 ? `−${String(counts.removed)}` : "",
    counts.moved > 0 ? `→${String(counts.moved)}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export const CHANGE_GLYPH = { added: "+", removed: "−", modified: "~", moved: "→" } as const;

export const CHANGE_LABEL = {
  added: "Added",
  removed: "Removed",
  modified: "Modified",
  moved: "Moved",
} as const;

const shortId = (id: string) => id.slice(id.indexOf(":") + 1);

/** Plain-language change for titles and labels. */
export function changeTitle(node: ModelNode): string {
  const c = node.change;
  if (!c || c.change === "unchanged") return "";
  if (c.change === "modified" && c.childChanged) return "Something inside changed";
  if (c.change === "moved" && c.movedFrom !== undefined)
    return `Moved from ${shortId(c.movedFrom)}`;
  return CHANGE_LABEL[c.change];
}
