import { copy } from "../copy";
import type { ModelNode } from "../model/buildModel";

/** The validator's verdict on a description, worded exactly as the Phase 09 prompt says. */
export function trustText(node: ModelNode): string {
  if (node.docStatus === "documented") return copy.trust.documented;
  if (node.docStatus === "undocumented") return copy.trust.undocumented;
  return node.childChanged === true && node.selfChanged !== true
    ? copy.trust.staleChild
    : copy.trust.staleSelf;
}
