import type { ModelNode } from "../model/buildModel";

/** The validator's verdict on a description, worded exactly as the Phase 09 prompt says. */
export function trustText(node: ModelNode): string {
  if (node.docStatus === "documented") return "Description matches the current code.";
  if (node.docStatus === "undocumented") return "No description yet.";
  return node.childChanged === true && node.selfChanged !== true
    ? "Something inside this element changed; its own code did not."
    : "This code changed after the description was written. Treat the description as possibly outdated.";
}
