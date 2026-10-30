import { copy } from "../copy";
import type { RepoBundle } from "../generated/contract";
import type { BannerId } from "../store/useAppStore";

export interface Banner {
  id: BannerId;
  severity: "warning" | "error";
  text: string;
  action: "validate" | "index" | "changes";
  actionLabel: string;
}

/** Above this many elements the map suggests a narrower view. */
export const LARGE_REPO_NODES = 20_000;

/** Which banners apply to a bundle (with its model's node count), most fundamental first. */
export function bannersFor(bundle: RepoBundle, nodes = 0): Banner[] {
  const { report, manifest, warnings } = bundle;
  const banners: Banner[] = [];
  if (!report) {
    banners.push({
      id: "report-missing",
      severity: "warning",
      text: copy.banners.reportMissing,
      action: "validate",
      actionLabel: "Validate",
    });
  } else {
    if (report.issues.some((i) => i.code === "structure-out-of-date")) {
      banners.push({
        id: "structure-out-of-date",
        severity: "warning",
        text: copy.banners.structureOutOfDate,
        action: "index",
        actionLabel: "Re-index",
      });
    }
    if (
      report.commitSha !== manifest.commitSha ||
      warnings.some((w) => w.code === "report-stale")
    ) {
      banners.push({
        id: "report-stale",
        severity: "warning",
        text: copy.banners.reportStale,
        action: "validate",
        actionLabel: "Validate",
      });
    }
  }
  if (nodes > LARGE_REPO_NODES) {
    banners.push({
      id: "large-repo",
      severity: "warning",
      text: copy.banners.large(nodes),
      action: "changes",
      actionLabel: copy.banners.largeAction,
    });
  }
  return banners;
}
