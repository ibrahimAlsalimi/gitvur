import type { RepoBundle } from "../generated/contract";
import type { BannerId } from "../store/useAppStore";

export interface Banner {
  id: BannerId;
  severity: "warning" | "error";
  text: string;
  action: "Validate" | "Re-index";
}

/** Which trust banners apply to a bundle, most fundamental first. */
export function bannersFor(bundle: RepoBundle): Banner[] {
  const { report, manifest, warnings } = bundle;
  if (!report) {
    return [
      { id: "report-missing", severity: "warning", text: "Not validated yet.", action: "Validate" },
    ];
  }
  const banners: Banner[] = [];
  if (report.issues.some((i) => i.code === "structure-out-of-date")) {
    banners.push({
      id: "structure-out-of-date",
      severity: "warning",
      text: "The code changed since this map was generated.",
      action: "Re-index",
    });
  }
  if (report.commitSha !== manifest.commitSha || warnings.some((w) => w.code === "report-stale")) {
    banners.push({
      id: "report-stale",
      severity: "warning",
      text: "Validation results are older than the map.",
      action: "Validate",
    });
  }
  return banners;
}
