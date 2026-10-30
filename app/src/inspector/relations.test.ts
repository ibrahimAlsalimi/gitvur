import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { RepoBundle } from "../generated/contract";
import { buildModel } from "../model/buildModel";
import { fileOf, isMethod, outline, relationGroups, shortHash, unresolvedIn } from "./relations";

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
const summary = (id: string) =>
  relationGroups(model, id).map(
    (g) =>
      `${g.label}: ${g.items.map((i) => `${i.otherId} ${i.edge.provenance}@${String(i.edge.evidence.line)}`).join(", ")}`,
  );

describe("relationGroups", () => {
  it("separates outgoing and incoming calls, syntactic before AI", () => {
    expect(summary("function:app.py:main")).toEqual([
      "Calls: class:shop/models.py:Book syntactic@12, class:shop/models.py:Toy syntactic@12, " +
        "class:shop/orders.py:OrderService syntactic@11, " +
        "function:shop/orders.py:OrderService.place ai@13",
    ]);
    expect(summary("function:shop/orders.py:OrderService.place")).toEqual([
      "Calls: function:shop/orders.py:OrderService.receipt syntactic@17, " +
        "function:shop/orders.py:OrderService.remember syntactic@16",
      "Called by: function:app.py:main ai@13",
    ]);
  });

  it("lists file imports in both directions and leaves out empty groups", () => {
    expect(summary("file:shop/orders.py")).toEqual([
      "Imports: file:shop/cache.py syntactic@4, file:shop/store.py syntactic@7, " +
        "file:shop/utils.py syntactic@3",
      "Imported by: file:app.py syntactic@6",
    ]);
    expect(relationGroups(model, "module:support")).toEqual([]);
  });
});

describe("inspector helpers", () => {
  it("finds unresolved calls inside a node's subtree", () => {
    const calls = unresolvedIn(model, "class:shop/orders.py:OrderService");
    expect(calls.map((u) => `${u.name}@${String(u.evidence.line)}`)).toEqual(["save@21"]);
    expect(unresolvedIn(model, "file:app.py")).toEqual([]);
  });

  it("outlines a file depth-first in source order", () => {
    expect(
      outline(model, "file:shop/store.py").map((o) => `${"  ".repeat(o.depth)}${o.node.name}`),
    ).toEqual(["Store", "  __init__", "  save", "    encode"]);
  });

  it("finds the containing file and methods", () => {
    expect(fileOf(model, "function:shop/store.py:Store.save.encode")?.id).toBe(
      "file:shop/store.py",
    );
    expect(fileOf(model, "module:storage")).toBeUndefined();
    const save = model.nodes.get("function:shop/store.py:Store.save");
    const encode = model.nodes.get("function:shop/store.py:Store.save.encode");
    expect(save && isMethod(model, save)).toBe(true);
    expect(encode && isMethod(model, encode)).toBe(false);
    expect(shortHash("sha256:eb63b6edd8b2")).toBe("eb63b6");
  });
});
