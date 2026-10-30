import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { RepoBundle, Structure } from "../generated/contract";
import { buildModel } from "../model/buildModel";
import { fuzzy, search, searchIndex } from "./searchIndex";

function bundle(structure?: Structure): RepoBundle {
  const read = (f: string): unknown =>
    JSON.parse(
      readFileSync(new URL(`../../../fixtures/py-small/.gitvur/${f}`, import.meta.url), "utf8"),
    );
  return {
    root: "py-small",
    manifest: read("manifest.json") as RepoBundle["manifest"],
    structure: structure ?? (read("structure.json") as Structure),
    annotations: read("annotations.json") as RepoBundle["annotations"],
    report: read("report.json") as RepoBundle["report"],
    warnings: [],
  };
}

const model = buildModel(bundle());
const ids = (q: string) => search(searchIndex(model), q).map((h) => h.entry.node.id);

describe("fuzzy", () => {
  it("matches subsequences and rewards word starts and runs", () => {
    expect(fuzzy("fp", "format_price", "format_price")?.positions).toEqual([0, 7]);
    expect(fuzzy("xyz", "format_price")).toBeNull();
    const prefix = fuzzy("form", "format_price")?.score ?? 0;
    const scattered = fuzzy("frmt", "format_price")?.score ?? 0;
    expect(prefix).toBeGreaterThan(scattered);
  });
});

describe("search", () => {
  it("finds names, qualified names, paths and description text", () => {
    expect(ids("save")[0]).toMatch(/\.save$/);
    expect(ids("Store.save")[0]).toBe("function:shop/store.py:Store.save");
    expect(ids("shop/utils")).toContain("file:shop/utils.py");
    // A word only in a description.
    const hit = search(searchIndex(model), "receipt line").find(
      (h) => h.entry.node.id === "function:shop/orders.py:OrderService.receipt",
    );
    expect(hit).toBeDefined();
    expect(search(searchIndex(model), "zzzz")).toEqual([]);
  });

  it("builds the index once per model", () => {
    expect(searchIndex(model)).toBe(searchIndex(model));
  });

  it("answers in under 30 ms on 5,000 functions", () => {
    const nodes: Structure["nodes"] = [{ id: "project:root", type: "project", name: "big" }];
    for (let f = 0; f < 250; f += 1) {
      const file = `pkg/mod${String(f)}/file${String(f)}.py`;
      nodes.push({
        id: `file:${file}`,
        type: "file",
        name: `file${String(f)}.py`,
        parentId: "project:root",
        source: { file, startLine: 1, endLine: 400 },
        contentHash: `sha256:${"0".repeat(64)}`,
      });
      for (let i = 0; i < 20; i += 1) {
        const name = `handle_request_${String(f)}_${String(i)}`;
        nodes.push({
          id: `function:${file}:${name}`,
          type: "function",
          name,
          parentId: `file:${file}`,
          source: { file, startLine: i * 10 + 1, endLine: i * 10 + 9 },
          contentHash: `sha256:${"0".repeat(64)}`,
        });
      }
    }
    const big = buildModel(bundle({ nodes, edges: [], unresolvedCalls: [] }));
    const index = searchIndex(big);
    expect(index.entries.length).toBeGreaterThanOrEqual(5250); // + the annotations' modules
    // Warm up once (JIT), then the median of five runs per query: the budget is about
    // search cost, not about other test workers competing for the CPU. The slowest single
    // run gets a looser bound so a query that is slow every other time still fails.
    search(index, "warm");
    const times: number[] = [];
    let worst = 0;
    for (const q of ["hr", "handle", "req 12", "file10", "zz", "h_r_1_1"]) {
      const runs: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        const start = performance.now();
        search(index, q);
        runs.push(performance.now() - start);
      }
      runs.sort((a, b) => a - b);
      times.push(runs[2] ?? 0);
      worst = Math.max(worst, runs[4] ?? 0);
    }
    times.sort((a, b) => a - b);
    expect(times[times.length - 1]).toBeLessThan(30);
    expect(worst).toBeLessThan(100);
  });
});
