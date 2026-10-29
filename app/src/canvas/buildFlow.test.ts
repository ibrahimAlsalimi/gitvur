import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { RepoBundle } from "../generated/contract";
import { computeLayout } from "../layout/computeLayout";
import { buildLayoutRequest } from "../layout/fromModel";
import { UNASSIGNED_MODULE_ID, buildModel } from "../model/buildModel";
import { applySelection, buildFlow, moduleColors, reuseNodes } from "./buildFlow";
import { lodForZoom } from "./lod";
import { middleTruncate } from "./text";

function bundle(fixture: string): RepoBundle {
  const read = (f: string): unknown =>
    JSON.parse(
      readFileSync(new URL(`../../../fixtures/${fixture}/.gitvur/${f}`, import.meta.url), "utf8"),
    );
  return {
    root: fixture,
    manifest: read("manifest.json") as RepoBundle["manifest"],
    structure: read("structure.json") as RepoBundle["structure"],
    annotations: read("annotations.json") as RepoBundle["annotations"],
    report: read("report.json") as RepoBundle["report"],
    warnings: [],
  };
}

const meta = { commitSha: "abc1234", languages: ["python"] };
const model = buildModel(bundle("py-small"));
const flowFor = (expanded: Set<string>) =>
  buildFlow(model, computeLayout(buildLayoutRequest(model, expanded)), expanded, meta);

describe("buildFlow", () => {
  it("assigns module colours by sorted id, neutral for unassigned", () => {
    const colors = moduleColors(model);
    expect([...colors.entries()].slice(0, 3)).toEqual([
      ["module:catalogue", "var(--gv-module-1)"],
      ["module:entry-point", "var(--gv-module-2)"],
      ["module:orders", "var(--gv-module-3)"],
    ]);
    expect(colors.get(UNASSIGNED_MODULE_ID)).toBe("var(--gv-module-neutral)");
  });

  it("nests files in modules and rows in expanded files", () => {
    const { nodes, edges } = flowFor(new Set(["file:shop/store.py"]));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(byId.get("file:shop/store.py")?.parentId).toBe("module:storage");
    const row = byId.get("function:shop/store.py:Store.save.encode");
    expect([row?.parentId, row?.extent]).toEqual(["file:shop/store.py", "parent"]);
    expect(nodes.filter((n) => n.type === "row")).toHaveLength(4);
    expect(edges.map((e) => e.target)).toEqual(["module:entry-point"]);
  });

  it("selection keeps the identity of unaffected nodes", () => {
    const { nodes } = flowFor(new Set());
    const selected = applySelection(nodes, "file:app.py");
    const changed = selected.filter((n, i) => n !== nodes[i]).map((n) => n.id);
    expect(changed).toEqual(["file:app.py"]);
    const again = applySelection(selected, "file:app.py");
    expect(again.every((n, i) => n === selected[i])).toBe(true);
  });

  it("reuseNodes keeps unchanged nodes across a rebuild", () => {
    const before = flowFor(new Set()).nodes;
    const after = reuseNodes(
      new Map(before.map((n) => [n.id, n])),
      flowFor(new Set(["file:shop/models.py"])).nodes,
    );
    const reused = new Set(after.filter((n) => before.includes(n)).map((n) => n.id));
    expect(reused.has("file:shop/cache.py")).toBe(true); // another module: untouched
    expect(reused.has("file:shop/models.py")).toBe(false); // expanded: changed
    expect(reused.has("module:catalogue")).toBe(false); // grew
  });
});

describe("helpers", () => {
  it("maps zoom to level of detail", () => {
    expect([0.2, 0.34, 0.35, 0.8, 0.81, 2].map(lodForZoom)).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it("middle-truncates paths", () => {
    expect(middleTruncate("src/a/b", 30)).toBe("src/a/b");
    const t = middleTruncate("packages/core/src/very/deep/nested/dir", 20);
    expect(t).toHaveLength(20);
    expect(t).toBe("packages/c…ested/dir");
  });
});
