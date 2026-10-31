/* eslint-disable @typescript-eslint/no-non-null-assertion -- known fixture indices */
import { describe, expect, it } from "vitest";
import type { Architecture, Structure } from "../generated/contract";
import { buildStructureDiagram, projectArchitecture } from "./model";
import { diagramToMermaid } from "./mermaid";
import { layoutDiagram } from "./layout";

const structure: Structure = {
  nodes: ["src/api/a.ts", "src/db/b.ts", "src/db/c.ts"].map((file) => ({
    id: `file:${file}`,
    type: "file",
    name: file.split("/").at(-1) ?? file,
    source: { file, startLine: 1, endLine: 10 },
    contentHash: "sha256:old",
  })),
  edges: ["src/db/b.ts", "src/db/c.ts"].map((file) => ({
    from: "file:src/api/a.ts",
    to: `file:${file}`,
    type: "imports",
    provenance: "syntactic",
    evidence: { file: "src/api/a.ts", line: 1 },
  })),
  unresolvedCalls: [],
};
const ai: Architecture = {
  version: 1,
  summary: "An example.",
  components: [
    {
      id: "arch:api",
      name: "API",
      kind: "api",
      responsibility: "Accepts requests.",
      sources: [{ node: "file:src/api/a.ts", basedOnHash: "sha256:old" }],
      provenance: "ai",
      evidence: [{ file: "src/api/a.ts", line: 1 }],
    },
  ],
  relationships: [],
};

describe("architecture projection", () => {
  it("groups files, aggregates verified imports, and is invariant to input order", () => {
    const a = buildStructureDiagram(structure);
    expect(a.components).toHaveLength(2);
    expect(a.relationships).toHaveLength(1);
    expect(a.relationships[0]?.label).toBe("Imports · 2 references");
    expect(
      buildStructureDiagram({
        ...structure,
        nodes: [...structure.nodes].reverse(),
        edges: [...structure.edges].reverse(),
      }),
    ).toEqual(a);
    expect(a.components.flatMap((c) => c.sources)).toHaveLength(3);
  });
  it("raw exploration excludes interpreted dependencies and never invents runtime claims", () => {
    const raw = buildStructureDiagram({
      ...structure,
      edges: [...structure.edges, { ...structure.edges[0]!, type: "calls", provenance: "ai" }],
    });
    expect(raw.components.every((c) => c.kind === "directory")).toBe(true);
    expect(raw.relationships).toHaveLength(1);
    expect(raw.relationships[0]?.label).toBe("Imports · 2 references");
    expect(raw.mode).toBe("Structure-derived");
  });
  it("handles empty and large repositories with progressive disclosure", () => {
    expect(buildStructureDiagram({ nodes: [], edges: [], unresolvedCalls: [] }).components).toEqual(
      [],
    );
    const large = buildStructureDiagram({
      ...structure,
      nodes: Array.from({ length: 1000 }, (_, i) => ({
        ...structure.nodes[0]!,
        id: `file:src/p${String(i)}/a.ts`,
        source: { file: `src/p${String(i)}/a.ts`, startLine: 1, endLine: 1 },
      })),
      edges: [],
    });
    expect(projectArchitecture(large, null).components).toHaveLength(1);
    expect(projectArchitecture(large, "arch:dir:src").components).toHaveLength(1000);
  });
  it("rolls up dependency counts and deduplicates evidence at group boundaries", () => {
    const a = buildStructureDiagram(structure);
    const root = { ...a.components[0]!, id: "arch:group", name: "Group", sources: [] };
    a.components.push(root);
    a.components[0]!.parent = root.id;
    const edge = a.relationships[0]!;
    a.relationships.push({ ...edge, id: "second", count: 3 });
    const view = projectArchitecture(a, null);
    expect(view.relationships).toHaveLength(1);
    expect(view.relationships[0]?.label).toBe("Imports · 5 references");
    expect(view.relationships[0]?.evidence).toHaveLength(1);
  });
  it("lays out finite nonoverlapping cards and exports escaped Mermaid", () => {
    const a = buildStructureDiagram(structure);
    const layout = layoutDiagram(a);
    expect(Object.values(layout).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(
      true,
    );
    expect(new Set(Object.values(layout).map((p) => `${String(p.x)},${String(p.y)}`)).size).toBe(2);
    a.components[0]!.name = 'API"<script>\nend';
    const mermaid = diagramToMermaid(a);
    expect(mermaid).toContain("#quot;");
    expect(mermaid).not.toContain("<script>");
    expect(mermaid).toContain("Imports");
  });
});

describe("saved architecture map", () => {
  const bundle = (issues: import("../generated/contract").Issue[] = []) =>
    ({
      root: "test",
      manifest: {
        schemaVersion: "0.3",
        projectName: "Example",
        commitSha: "uncommitted",
        generatedAt: "",
        extractor: { name: "test", version: "1" },
        languages: [],
      },
      structure,
      annotations: { modules: [], descriptions: [], edges: [], architecture: ai },
      report: null,
      warnings: [],
      architectureIssues: issues,
    }) satisfies import("../generated/contract").RepoBundle;
  it("does not synthesize directory boxes or import arrows around authored components", async () => {
    const { savedArchitecture } = await import("./model");
    const map = savedArchitecture(bundle());
    expect(map?.components.map((c) => c.name)).toEqual(["API"]);
    expect(map?.relationships).toEqual([]);
    expect(savedArchitecture({ ...bundle(), annotations: null })).toBeNull();
    const unvalidated: import("../generated/contract").RepoBundle = bundle();
    delete unvalidated.architectureIssues;
    expect(savedArchitecture(unvalidated)).toBeNull();
  });
  it("prefers the artifact and blocks malformed data instead of silently using legacy", async () => {
    const { savedArchitecture } = await import("./model");
    const b = bundle();
    const architecture = {
      schemaVersion: 1,
      commitSha: "uncommitted",
      indexHash: "hash",
      architecture: { ...ai, summary: "Standalone system story" },
    };
    expect(savedArchitecture({ ...b, architecture })?.summary).toBe("Standalone system story");
    expect(
      savedArchitecture({
        ...b,
        architectureIssues: [
          {
            code: "architecture-schema",
            severity: "error",
            id: "architecture",
            message: "bad JSON",
          },
        ],
      }),
    ).toBeNull();
    expect(
      savedArchitecture(
        bundle([
          { code: "architecture-stale", severity: "warning", id: "arch:api", message: "changed" },
        ]),
      )?.components[0]?.status,
    ).toBe("stale");
  });
  it("keeps hierarchy in search and lays children inside subsystem bounds", async () => {
    const { savedArchitecture, filterArchitecture } = await import("./model");
    const map = savedArchitecture(bundle())!;
    const parent = { ...map.components[0]!, id: "arch:group", name: "Application", sources: [] };
    map.components[0]!.parent = parent.id;
    map.components.push(parent);
    const filtered = filterArchitecture(map, "Accepts requests");
    expect(filtered.components).toHaveLength(2);
    const layout = layoutDiagram(filtered);
    const child = layout["arch:api"]!,
      group = layout["arch:group"]!;
    expect(child.y).toBeGreaterThanOrEqual(100);
    expect(child.x + child.width).toBeLessThan(group.width);
    expect(child.y + child.height).toBeLessThan(group.height);
  });
});

describe("architecture navigation and reading layout", () => {
  it("matches contained code without attributing unrelated functions in the same file", async () => {
    const { referencesNode } = await import("./model");
    const file = "src/api/a.ts";
    const s: Structure = {
      ...structure,
      nodes: [
        ...structure.nodes,
        {
          id: "class:router",
          name: "Router",
          type: "class",
          source: { file, startLine: 2, endLine: 6 },
          contentHash: "hash",
        },
        {
          id: "function:route",
          name: "route",
          type: "function",
          source: { file, startLine: 3, endLine: 4 },
          contentHash: "hash",
        },
        {
          id: "function:unrelated",
          name: "unrelated",
          type: "function",
          source: { file, startLine: 8, endLine: 9 },
          contentHash: "hash",
        },
      ],
    };
    const sources = [{ node: "class:router", basedOnHash: "hash" }];
    expect(referencesNode(s, sources, "function:route")).toBe(true);
    expect(referencesNode(s, sources, "function:unrelated")).toBe(false);
    expect(referencesNode(s, sources, "missing")).toBe(false);
  });
  it("fits a longer system story into reading rows without overlapping cards", () => {
    const components = Array.from({ length: 7 }, (_, i) => ({
      ...ai.components[0]!,
      id: `arch:part-${String(i)}`,
      status: "current" as const,
    }));
    const map: import("./model").Diagram = {
      version: 1,
      mode: "Architecture map",
      summary: "A seven-stage system",
      components,
      relationships: components.slice(1).map((c, i) => ({
        id: `arch:interaction-${String(i)}`,
        from: components[i]!.id,
        to: c.id,
        kind: "invokes",
        label: "Invokes next stage",
        provenance: "ai",
        evidence: [],
        count: 1,
      })),
    };
    const positions = Object.values(layoutDiagram(map));
    expect(positions).toHaveLength(7);
    expect(Math.max(...positions.map((p) => p.x + p.width))).toBeLessThan(1800);
    for (let i = 0; i < positions.length; i++)
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i]!,
          b = positions[j]!;
        expect(
          a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y,
        ).toBe(true);
      }
  });
});
