import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { RepoBundle } from "../generated/contract";
import { aggregateEdges, countLabel, subtree, visibleAncestor } from "./aggregateEdges";
import { buildModel } from "./buildModel";

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

const model = buildModel(bundle("py-small"));
const pairs = (edges: ReturnType<typeof aggregateEdges>) =>
  edges
    .map(
      (e) =>
        `${e.source} -> ${e.target} ${e.type}/${e.provenance} ×${String(e.pairs.length)}${e.aggregated ? " agg" : ""}`,
    )
    .sort();

describe("visibleAncestor", () => {
  it("lifts rows of collapsed files to the file, and everything to modules at low LOD", () => {
    const collapsed = visibleAncestor(model, new Set(), 2);
    expect(collapsed("function:shop/store.py:Store.save.encode")).toBe("file:shop/store.py");
    const expanded = visibleAncestor(model, new Set(["file:shop/store.py"]), 2);
    expect(expanded("function:shop/store.py:Store.save.encode")).toBe(
      "function:shop/store.py:Store.save.encode",
    );
    const mid = visibleAncestor(model, new Set(["file:shop/store.py"]), 1);
    expect(mid("function:shop/store.py:Store.save.encode")).toBe("file:shop/store.py");
    const low = visibleAncestor(model, new Set(["file:shop/store.py"]), 0);
    expect(low("function:shop/store.py:Store.save")).toBe("module:storage");
    expect(low("project:root")).toBeUndefined();
  });
});

describe("aggregateEdges", () => {
  it("draws a function's edges to collapsed files with counts", () => {
    const visible = visibleAncestor(model, new Set(["file:app.py"]), 2);
    expect(pairs(aggregateEdges(model, "function:app.py:main", visible))).toEqual([
      "function:app.py:main -> file:shop/models.py calls/syntactic ×2 agg",
      "function:app.py:main -> file:shop/orders.py calls/ai ×1 agg",
      "function:app.py:main -> file:shop/orders.py calls/syntactic ×1 agg",
    ]);
  });

  it("keeps provenances apart so parallel lines can be offset", () => {
    const visible = visibleAncestor(model, new Set(), 1);
    const lines = aggregateEdges(model, "file:shop/orders.py", visible);
    const toCache = lines.filter((l) => l.target === "file:shop/cache.py");
    expect(toCache.map((l) => `${l.type}/${l.provenance}`).sort()).toEqual([
      "calls/ai",
      "calls/syntactic",
      "imports/syntactic",
    ]);
  });

  it("drops edges that collapse into a self-loop", () => {
    const visible = visibleAncestor(model, new Set(), 1);
    const lines = aggregateEdges(model, "file:shop/store.py", visible);
    expect(lines.some((l) => l.source === l.target)).toBe(false);
    // Store.save → Store.save.encode is internal to the collapsed file: not drawn.
    expect(
      lines.every((l) => l.pairs.every((p) => p.to !== "function:shop/store.py:Store.save.encode")),
    ).toBe(true);
  });

  it("adds a second hop", () => {
    const visible = visibleAncestor(model, new Set(), 1);
    const one = aggregateEdges(model, "file:shop/models.py", visible, 1);
    const two = aggregateEdges(model, "file:shop/models.py", visible, 2);
    expect(one.every((l) => l.hop === 1)).toBe(true);
    expect(two.length).toBeGreaterThan(one.length);
    const second = two.filter((l) => l.hop === 2);
    expect(
      second.some((l) => l.source === "file:app.py" && l.target === "file:shop/orders.py"),
    ).toBe(true);
  });

  it("is deterministic and keeps the original pairs", () => {
    const visible = visibleAncestor(model, new Set(), 0);
    const a = aggregateEdges(model, "module:orders", visible, 2);
    const b = aggregateEdges(model, "module:orders", visible, 2);
    expect(a).toEqual(b);
    const total = a.reduce((n, l) => n + l.pairs.length, 0);
    expect(total).toBeGreaterThan(a.length);
  });

  it("subtree and labels", () => {
    expect(subtree(model, "class:shop/store.py:Store").size).toBe(4);
    expect([countLabel(1, "calls"), countLabel(3, "calls"), countLabel(2, "depends_on")]).toEqual([
      "1 call",
      "3 calls",
      "2 dependencies",
    ]);
  });
});
