import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { trustBundle } from "../api/mockTrust";
import type { RepoBundle } from "../generated/contract";
import { buildModel, sortIssues } from "./buildModel";
import { filteredRows } from "./tree";

function bundle(): RepoBundle {
  const read = (f: string): unknown =>
    JSON.parse(
      readFileSync(new URL(`../../../fixtures/py-small/.gitvur/${f}`, import.meta.url), "utf8"),
    );
  return {
    root: "py-small",
    manifest: read("manifest.json") as RepoBundle["manifest"],
    structure: read("structure.json") as RepoBundle["structure"],
    annotations: read("annotations.json") as RepoBundle["annotations"],
    report: read("report.json") as RepoBundle["report"],
    warnings: [],
  };
}

const model = buildModel(trustBundle(bundle()));

describe("trust data in the model", () => {
  it("counts statuses and issues in total and per module", () => {
    expect(model.totals).toMatchObject({
      documentable: 39,
      documented: 29,
      stale: 5,
      undocumented: 5,
      errors: 7,
      warnings: 5,
    });
    expect(model.moduleStats.get("module:orders")).toMatchObject({
      documented: 3,
      stale: 3,
      undocumented: 0,
      errors: 1,
    });
    expect(model.moduleStats.get("module:storage")?.errors).toBe(2);
  });

  it("keeps the stale flags and attaches issues to their elements, errors first", () => {
    const receipt = model.nodes.get("function:shop/orders.py:OrderService.receipt");
    expect([receipt?.docStatus, receipt?.selfChanged, receipt?.childChanged]).toEqual([
      "stale",
      true,
      false,
    ]);
    const file = model.nodes.get("file:shop/orders.py");
    expect([file?.docStatus, file?.selfChanged, file?.childChanged]).toEqual([
      "stale",
      false,
      true,
    ]);
    const remember = model.nodes.get("function:shop/orders.py:OrderService.remember");
    expect(remember?.issues.map((i) => i.code)).toEqual([
      "ai-edge-evidence-out-of-range",
      "ai-edge-evidence-mismatch",
    ]);
    expect(model.nodes.get("function:shop/models.py:Toy.label")?.description).toBeUndefined();
    expect(model.issues.map((i) => i.severity).indexOf("warning")).toBe(7);
  });

  it("sorts issues by severity, code, then id (issues without an id last)", () => {
    const sorted = sortIssues([
      { severity: "warning", code: "b", message: "" },
      { severity: "warning", code: "a", message: "", id: "y" },
      { severity: "error", code: "z", message: "" },
      { severity: "warning", code: "a", message: "" },
      { severity: "warning", code: "a", message: "", id: "x" },
    ]);
    expect(sorted.map((i) => `${i.severity[0] ?? ""}:${i.code}:${i.id ?? "-"}`)).toEqual([
      "e:z:-",
      "w:a:x",
      "w:a:y",
      "w:a:-",
      "w:b:-",
    ]);
  });

  it("filters the explorer to one status with the ancestors that place it", () => {
    const rows = filteredRows(model, "undocumented");
    expect(rows.map((r) => `${"  ".repeat(r.level - 1)}${r.node.name}`)).toEqual([
      "Catalogue",
      "  models.py",
      "    Toy",
      "      label",
      "Storage",
      "  cache.py",
      "    Cache",
      "      lookup",
      "Support",
      "  __init__.py",
      "  utils.py",
      "    to_amount",
      "    to_amount",
    ]);
    expect(rows.every((r) => r.expanded === r.hasChildren)).toBe(true);
  });
});
