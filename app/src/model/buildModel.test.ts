import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { Node, RepoBundle, Structure } from "../generated/contract";
import { UNASSIGNED_MODULE_ID, UNASSIGNED_MODULE_NAME, buildModel } from "./buildModel";
import { ancestors, defaultExpanded, visibleRows } from "./tree";

function readJson(fixture: string, file: string): unknown {
  const url = new URL(`../../../fixtures/${fixture}/.gitvur/${file}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8"));
}

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("fixture value missing");
  return value;
}

function fixtureBundle(fixture: "py-small" | "ts-small"): RepoBundle {
  return {
    root: `/fixtures/${fixture}`,
    manifest: readJson(fixture, "manifest.json") as RepoBundle["manifest"],
    structure: readJson(fixture, "structure.json") as RepoBundle["structure"],
    annotations: readJson(fixture, "annotations.json") as RepoBundle["annotations"],
    report: readJson(fixture, "report.json") as RepoBundle["report"],
    warnings: [],
  };
}

describe("buildModel on py-small", () => {
  const model = buildModel(fixtureBundle("py-small"));

  it("re-parents files under their logical module", () => {
    expect(model.parentById.get("file:shop/orders.py")).toBe("module:orders");
    expect(model.childrenById.get("module:storage")).toEqual([
      "file:shop/cache.py",
      "file:shop/store.py",
    ]);
    expect(model.parentById.get("module:orders")).toBe("project:root");
    expect(model.nodes.has(UNASSIGNED_MODULE_ID)).toBe(false);
  });

  it("keeps class and function nesting, ordered by line", () => {
    expect(model.childrenById.get("class:shop/models.py:Toy")).toEqual([
      "function:shop/models.py:Toy.__init__",
      "function:shop/models.py:Toy.label",
      "function:shop/models.py:Toy.describe",
    ]);
    expect(model.depthById.get("module:orders")).toBe(1);
    expect(model.depthById.get("file:shop/store.py")).toBe(2);
    expect(model.depthById.get("function:shop/store.py:Store.save.encode")).toBe(5);
  });

  it("attaches descriptions and statuses", () => {
    const label = model.nodes.get("function:shop/models.py:Toy.label");
    expect(label?.description).toBe("Returns the toy's name in upper case.");
    expect(label?.docStatus).toBe("documented");
    expect(model.nodes.get("module:storage")?.description).toMatch(/JSON file store/);
  });

  it("indexes edges from both layers with provenance", () => {
    const out = (model.outgoing.get("function:shop/orders.py:OrderService.remember") ?? []).map(
      (i) => model.edges[i],
    );
    expect(out.map((e) => [e?.to, e?.provenance, e?.origin])).toEqual([
      ["function:shop/cache.py:Cache.save", "ai", "annotations"],
      ["function:shop/store.py:Store.save", "ai", "annotations"],
    ]);
    const into = model.incoming.get("file:shop/utils.py") ?? [];
    expect(into.map((i) => model.edges[i]?.provenance)).toEqual(["syntactic"]);
    expect(
      model.unresolvedByFrom.get("function:shop/orders.py:OrderService.remember"),
    ).toHaveLength(1);
  });

  it("counts per module and in total", () => {
    expect(model.moduleStats.get("module:storage")).toEqual({
      files: 2,
      classes: 2,
      functions: 7,
      documented: 11,
      documentedPct: 100,
    });
    expect(model.totals).toMatchObject({
      files: 7,
      classes: 5,
      functions: 22,
      modules: 5,
      edges: 21,
      unresolved: 1,
      documentable: 39,
      documented: 39,
      documentedPct: 100,
    });
  });
});

describe("buildModel edge cases", () => {
  it("groups files without a module under Unassigned files", () => {
    const bundle = fixtureBundle("py-small");
    bundle.annotations = {
      ...must(bundle.annotations),
      modules: must(bundle.annotations).modules.filter((m) => m.id !== "module:storage"),
    };
    const model = buildModel(bundle);
    const unassigned = model.nodes.get(UNASSIGNED_MODULE_ID);
    expect(unassigned?.name).toBe(UNASSIGNED_MODULE_NAME);
    expect(unassigned?.synthetic).toBe(true);
    expect(model.childrenById.get(UNASSIGNED_MODULE_ID)).toEqual([
      "file:shop/cache.py",
      "file:shop/store.py",
    ]);
    const top = model.childrenById.get(model.rootId) ?? [];
    expect(top[top.length - 1]).toBe(UNASSIGNED_MODULE_ID);
  });

  it("works with structure only", () => {
    const bundle = fixtureBundle("ts-small");
    bundle.annotations = null;
    bundle.report = null;
    const model = buildModel(bundle);
    expect(model.childrenById.get(model.rootId)).toEqual([UNASSIGNED_MODULE_ID]);
    expect(model.childrenById.get(UNASSIGNED_MODULE_ID)).toHaveLength(9);
    expect(model.totals.documented).toBe(0);
    expect(
      [...model.nodes.values()].every(
        (n) => n.kind === "project" || n.docStatus === "undocumented",
      ),
    ).toBe(true);
  });

  it("computes the same statuses as the validator when report.json is missing", () => {
    for (const fixture of ["py-small", "ts-small"] as const) {
      const withReport = fixtureBundle(fixture);
      const without = { ...withReport, report: null };
      const a = buildModel(withReport);
      const b = buildModel(without);
      for (const [id, node] of a.nodes) {
        expect([id, b.nodes.get(id)?.docStatus]).toEqual([id, node.docStatus]);
      }
    }
  });

  it("marks stale descriptions and propagates childChanged without a report", () => {
    const bundle = fixtureBundle("py-small");
    bundle.report = null;
    bundle.annotations = {
      ...must(bundle.annotations),
      descriptions: must(bundle.annotations).descriptions.map((d) =>
        [
          "function:shop/models.py:Toy.label",
          "class:shop/models.py:Toy",
          "file:shop/models.py",
        ].includes(d.id)
          ? { ...d, basedOnHash: `sha256:${"0".repeat(64)}` }
          : d,
      ),
    };
    const model = buildModel(bundle);
    const label = model.nodes.get("function:shop/models.py:Toy.label");
    const toy = model.nodes.get("class:shop/models.py:Toy");
    expect([label?.docStatus, label?.selfChanged, label?.childChanged]).toEqual([
      "stale",
      true,
      false,
    ]);
    expect([toy?.docStatus, toy?.selfChanged, toy?.childChanged]).toEqual(["stale", false, true]);
    expect(model.nodes.get("function:shop/models.py:Toy.describe")?.docStatus).toBe("documented");
  });

  it("ignores empty descriptions", () => {
    const bundle = fixtureBundle("py-small");
    bundle.report = null;
    bundle.annotations = {
      ...must(bundle.annotations),
      descriptions: must(bundle.annotations).descriptions.map((d) =>
        d.id === "function:app.py:main" ? { ...d, text: "   " } : d,
      ),
    };
    const main = buildModel(bundle).nodes.get("function:app.py:main");
    expect(main?.docStatus).toBe("undocumented");
    expect(main?.description).toBeUndefined();
  });
});

describe("tree rows", () => {
  const model = buildModel(fixtureBundle("py-small"));

  it("shows modules and files by default, classes collapsed", () => {
    const rows = visibleRows(model, defaultExpanded(model));
    expect(rows.filter((r) => r.level === 1).map((r) => r.node.name)).toEqual([
      "Catalogue",
      "Entry point",
      "Orders",
      "Storage",
      "Support",
    ]);
    expect(rows.every((r) => r.node.kind === "module" || r.node.kind === "file")).toBe(true);
    expect(rows).toHaveLength(12);
    const storage = rows.find((r) => r.node.id === "module:storage");
    expect([storage?.expanded, storage?.posInSet, storage?.setSize]).toEqual([true, 4, 5]);
  });

  it("descends into expanded files and classes", () => {
    const expanded = new Set([
      ...defaultExpanded(model),
      "file:shop/models.py",
      "class:shop/models.py:Toy",
    ]);
    const names = visibleRows(model, expanded)
      .filter((r) => r.level >= 3)
      .map((r) => `${r.level}:${r.node.name}`);
    expect(names).toEqual(["3:Book", "3:Toy", "4:__init__", "4:label", "4:describe"]);
  });

  it("lists ancestors nearest first", () => {
    expect(ancestors(model, "function:shop/store.py:Store.save.encode")).toEqual([
      "function:shop/store.py:Store.save",
      "class:shop/store.py:Store",
      "file:shop/store.py",
      "module:storage",
    ]);
  });
});

/** ~10,000 nodes: 50 modules × 20 files × (1 class with 6 methods + 2 functions + 1 file node). */
function syntheticBundle(): RepoBundle {
  const nodes: Node[] = [{ id: "project:root", type: "project", name: "synthetic" }];
  const modules: { id: string; name: string; description: string; files: string[] }[] = [];
  const descriptions: { id: string; text: string; basedOnHash: string }[] = [];
  const hash = (i: number) => `sha256:${i.toString(16).padStart(64, "0")}`;
  let n = 0;
  const add = (node: Node) => {
    nodes.push(node);
    if (n % 3 !== 0)
      descriptions.push({
        id: node.id,
        text: "x",
        basedOnHash: n % 5 === 0 ? hash(0) : (node.contentHash as string),
      });
    n += 1;
  };
  for (let m = 0; m < 50; m++) {
    const files: string[] = [];
    for (let f = 0; f < 20; f++) {
      const path = `pkg${m}/mod${f}.py`;
      const file = `file:${path}`;
      files.push(file);
      const src = (start: number, end: number) => ({ file: path, startLine: start, endLine: end });
      add({
        id: file,
        type: "file",
        name: `mod${f}.py`,
        parentId: "project:root",
        source: src(1, 100),
        contentHash: hash(n + 1),
      });
      const cls = `class:${path}:C`;
      add({
        id: cls,
        type: "class",
        name: "C",
        parentId: file,
        source: src(1, 60),
        contentHash: hash(n + 1),
      });
      for (let k = 0; k < 6; k++) {
        add({
          id: `function:${path}:C.m${k}`,
          type: "function",
          name: `m${k}`,
          parentId: cls,
          source: src(2 + k * 9, 9 + k * 9),
          contentHash: hash(n + 1),
        });
      }
      for (let k = 0; k < 2; k++) {
        add({
          id: `function:${path}:f${k}`,
          type: "function",
          name: `f${k}`,
          parentId: file,
          source: src(61 + k * 10, 70 + k * 10),
          contentHash: hash(n + 1),
        });
      }
    }
    modules.push({ id: `module:m${m}`, name: `Module ${m}`, description: "d", files });
  }
  const structure: Structure = {
    nodes,
    edges: nodes.slice(1, 2001).map((node, i) => ({
      from: node.id,
      to: nodes[((i * 7) % (nodes.length - 1)) + 1]?.id ?? node.id,
      type: "calls",
      provenance: "syntactic",
      evidence: { file: "x.py", line: 1 },
    })),
    unresolvedCalls: [],
  };
  return {
    root: "/synthetic",
    manifest: {
      schemaVersion: "0.2",
      projectName: "synthetic",
      commitSha: "uncommitted",
      generatedAt: "t",
      extractor: { name: "gitvur-index", version: "0.2.0" },
      languages: ["python"],
    },
    structure,
    annotations: { modules, descriptions, edges: [] },
    report: null,
    warnings: [],
  };
}

describe("performance", () => {
  it("builds a 10,000-node model in under 100 ms", () => {
    const bundle = syntheticBundle();
    expect(bundle.structure.nodes.length).toBeGreaterThanOrEqual(10_000);
    let best = Infinity;
    for (let run = 0; run < 5; run++) {
      const start = performance.now();
      const model = buildModel(bundle);
      best = Math.min(best, performance.now() - start);
      expect(model.totals.files).toBe(1000);
    }
    console.info(`buildModel(10k nodes): best of 5 = ${best.toFixed(1)} ms`);
    expect(best).toBeLessThan(100);
  });
});
