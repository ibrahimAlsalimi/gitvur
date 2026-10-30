import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import mockDiff from "../api/mockDiff.json";
import type { DiffBundle, RepoBundle } from "../generated/contract";
import { buildDiffView } from "./diffModel";

function base(): RepoBundle {
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

const view = buildDiffView((mockDiff as unknown as { bundle: DiffBundle }).bundle, base());
const change = (id: string) => view.model.nodes.get(id)?.change;

describe("buildDiffView", () => {
  it("adds removed elements as ghosts under their old parent", () => {
    expect(change("function:shop/utils.py:cents")?.change).toBe("removed");
    expect(view.model.parentById.get("function:shop/utils.py:cents")).toBe("file:shop/utils.py");
    expect(view.model.nodes.has("function:shop/models.py:format_price")).toBe(false);
  });

  it("classifies every element and keeps moves' origins", () => {
    expect(change("function:shop/utils.py:slugify")?.change).toBe("added");
    expect(change("function:shop/orders.py:OrderService.receipt")).toEqual({
      change: "modified",
      childChanged: false,
    });
    expect(change("class:shop/orders.py:OrderService")).toEqual({
      change: "modified",
      childChanged: true,
    });
    expect(change("function:shop/utils.py:format_price")).toEqual({
      change: "moved",
      childChanged: false,
      movedFrom: "function:shop/models.py:format_price",
    });
    expect(change("function:shop/store.py:Store.save")?.change).toBe("unchanged");
  });

  it("steps through real changes in tree order and expands only their ancestors", () => {
    // Siblings sort by line; a ghost keeps its line from A ("its old position").
    expect(view.steps).toEqual([
      "function:shop/models.py:Toy.label",
      "function:shop/models.py:Toy.describe",
      "function:shop/orders.py:OrderService.receipt",
      "function:shop/utils.py:cents",
      "function:shop/utils.py:format_price",
      "function:shop/utils.py:format_price.with_symbol",
      "function:shop/utils.py:slugify",
    ]);
    expect([...view.expanded].sort()).toEqual([
      "class:shop/models.py:Toy",
      "class:shop/orders.py:OrderService",
      "file:shop/models.py",
      "file:shop/orders.py",
      "file:shop/utils.py",
      "function:shop/utils.py:format_price",
      "module:catalogue",
      "module:orders",
      "module:support",
    ]);
    expect(view.summary).toEqual({ added: 2, removed: 1, modified: 2, moved: 2 });
    expect(change("module:support")?.counts).toEqual({
      added: 1,
      removed: 1,
      modified: 0,
      moved: 2,
    });
    expect(change("module:storage")?.change).toBe("unchanged");
  });

  it("marks added and removed edges", () => {
    const marked = view.model.edges
      .filter((e) => e.change !== undefined)
      .map((e) => `${e.change ?? ""} ${e.from} -> ${e.to}`)
      .sort();
    expect(marked).toEqual([
      "added file:shop/orders.py -> file:shop/utils.py",
      "added function:shop/models.py:Toy.describe -> function:shop/models.py:Toy.label",
      "added function:shop/orders.py:OrderService.receipt -> function:shop/utils.py:slugify",
      "removed file:shop/orders.py -> file:shop/models.py",
    ]);
  });
});
