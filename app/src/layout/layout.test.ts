import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { RepoBundle } from "../generated/contract";
import { buildModel } from "../model/buildModel";
import { computeLayout, computeModuleGrid, createLayoutCache } from "./computeLayout";
import {
  CLASS_ROW_HEIGHT,
  FILE_GAP,
  FILE_HEIGHT,
  FILE_WIDTH,
  FUNCTION_ROW_HEIGHT,
  MODULE_HEADER,
  MODULE_PADDING,
  PROJECT_GAP,
  PROJECT_HEIGHT,
  ROW_INDENT,
  gridColumns,
} from "./constants";
import { buildLayoutRequest, fileRows, moduleEdges, moduleOf } from "./fromModel";
import type { LayoutModule } from "./types";

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

const files = (n: number, expanded: (i: number) => number = () => 0): LayoutModule => ({
  id: "module:m",
  files: Array.from({ length: n }, (_, i) => ({
    id: `file:f${String(i).padStart(3, "0")}.py`,
    expanded: expanded(i) > 0,
    rows: Array.from({ length: expanded(i) }, (_, r) => ({
      id: `function:f${String(i)}.py:r${String(r)}`,
      kind: "function" as const,
      depth: 0,
    })),
  })),
});

describe("grid", () => {
  it("uses clamp(1, ceil(sqrt(n * 1.6)), 6) columns", () => {
    expect([1, 2, 3, 4, 7, 10, 22, 23, 40].map(gridColumns)).toEqual([2, 2, 3, 3, 4, 4, 6, 6, 6]);
    expect(gridColumns(0)).toBe(1);
  });

  it("packs files row-major and sizes the module from its grid", () => {
    const grid = computeModuleGrid(files(5)); // 3 columns, 2 rows
    expect(grid.files["file:f000.py"]).toEqual({
      x: MODULE_PADDING,
      y: MODULE_HEADER,
      width: FILE_WIDTH,
      height: FILE_HEIGHT,
    });
    expect(grid.files["file:f002.py"]?.x).toBe(MODULE_PADDING + 2 * (FILE_WIDTH + FILE_GAP));
    expect(grid.files["file:f003.py"]).toMatchObject({
      x: MODULE_PADDING,
      y: MODULE_HEADER + FILE_HEIGHT + FILE_GAP,
    });
    expect(grid.width).toBe(2 * MODULE_PADDING + 3 * FILE_WIDTH + 2 * FILE_GAP);
    expect(grid.height).toBe(MODULE_HEADER + 2 * FILE_HEIGHT + FILE_GAP + MODULE_PADDING);
  });

  it("a grid row takes the height of its tallest card", () => {
    const grid = computeModuleGrid(files(4, (i) => (i === 1 ? 3 : 0))); // 3 columns
    const tall = FILE_HEIGHT + 3 * FUNCTION_ROW_HEIGHT + 8;
    expect(grid.files["file:f001.py"]?.height).toBe(tall);
    expect(grid.files["file:f003.py"]?.y).toBe(MODULE_HEADER + tall + FILE_GAP);
    expect(grid.rows["function:f1.py:r2"]).toEqual({
      x: 8,
      y: FILE_HEIGHT + 2 * FUNCTION_ROW_HEIGHT,
      width: FILE_WIDTH - 16,
      height: FUNCTION_ROW_HEIGHT,
    });
  });

  it("all coordinates are multiples of 4", () => {
    const grid = computeModuleGrid(files(9, (i) => i % 3));
    for (const box of [...Object.values(grid.files), ...Object.values(grid.rows)]) {
      for (const v of [box.x, box.y, box.width, box.height]) expect(v % 4).toBe(0);
    }
  });
});

describe("py-small", () => {
  const model = buildModel(bundle("py-small"));

  it("aggregates file imports and calls into module dependencies", () => {
    expect(moduleEdges(model)).toEqual([
      ["module:entry-point", "module:catalogue"],
      ["module:entry-point", "module:orders"],
      ["module:orders", "module:storage"],
      ["module:orders", "module:support"],
    ]);
    expect(moduleOf(model, "function:shop/store.py:Store.save.encode")).toBe("module:storage");
  });

  it("puts dependents above their dependencies", () => {
    const layout = computeLayout(buildLayoutRequest(model, new Set()));
    const y = (id: string) => layout.modules[id]?.y ?? NaN;
    expect(y("module:entry-point")).toBeLessThan(y("module:orders"));
    expect(y("module:orders")).toBeLessThan(y("module:storage"));
    expect(layout.ranks["module:entry-point"]).toBe(0);
    expect(Math.min(...Object.values(layout.modules).map((b) => b.y))).toBeGreaterThanOrEqual(
      PROJECT_HEIGHT + PROJECT_GAP,
    );
    expect(layout.project).toMatchObject({ x: 0, y: 0, height: PROJECT_HEIGHT });
    expect(layout.project.width).toBe(layout.width);
  });

  it("module containers never overlap", () => {
    const boxes = Object.values(computeLayout(buildLayoutRequest(model, new Set())).modules);
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) {
        const overlap =
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height;
        expect(overlap).toBe(false);
      }
    }
  });

  it("lists rows depth-first with methods and nested functions indented", () => {
    expect(
      fileRows(model, "file:shop/store.py").map(
        (r) => `${String(r.depth)}:${r.id.split(":").pop() ?? ""}`,
      ),
    ).toEqual(["0:Store", "1:Store.__init__", "1:Store.save", "2:Store.save.encode"]);
    const layout = computeLayout(buildLayoutRequest(model, new Set(["file:shop/store.py"])));
    expect(layout.rows["class:shop/store.py:Store"]).toMatchObject({
      x: 8,
      height: CLASS_ROW_HEIGHT,
    });
    expect(layout.rows["function:shop/store.py:Store.save.encode"]?.x).toBe(8 + 2 * ROW_INDENT);
    expect(layout.files["file:shop/store.py"]?.height).toBe(
      FILE_HEIGHT + CLASS_ROW_HEIGHT + 3 * FUNCTION_ROW_HEIGHT + 8,
    );
  });

  it("expanding a file recomputes only that module's grid", () => {
    const cache = createLayoutCache();
    const first = computeLayout(buildLayoutRequest(model, new Set()), cache);
    expect(first.recomputed).toHaveLength(5);
    const second = computeLayout(
      buildLayoutRequest(model, new Set(["file:shop/models.py"])),
      cache,
    );
    expect(second.recomputed).toEqual(["module:catalogue"]);
    const ranking = cache.ranking;
    expect(ranking).toBeDefined();
    const third = computeLayout(buildLayoutRequest(model, new Set(["file:shop/models.py"])), cache);
    expect(cache.ranking).toBe(ranking); // Dagre ranking reused: expand changes heights only
    expect(third.recomputed).toEqual([]);
    expect(third).toEqual({ ...second, recomputed: [] });
  });

  it("is deterministic", () => {
    const a = computeLayout(buildLayoutRequest(model, new Set(["file:app.py"])));
    const b = computeLayout(buildLayoutRequest(model, new Set(["file:app.py"])));
    expect(a).toEqual(b);
  });
});
