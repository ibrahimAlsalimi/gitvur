/* eslint-disable @typescript-eslint/no-non-null-assertion -- known fixture indices */
import { describe, expect, it } from "vitest";
import type { Architecture, Structure } from "../generated/contract";
import { buildArchitecture, projectArchitecture } from "./model";
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
    const a = buildArchitecture(structure);
    expect(a.components).toHaveLength(2);
    expect(a.relationships).toHaveLength(1);
    expect(a.relationships[0]?.label).toBe("Imports · 2 references");
    expect(
      buildArchitecture({
        ...structure,
        nodes: [...structure.nodes].reverse(),
        edges: [...structure.edges].reverse(),
      }),
    ).toEqual(a);
    expect(a.components.flatMap((c) => c.sources)).toHaveLength(3);
  });
  it("enriches claimed files and retains unclaimed groups and structural facts", () => {
    const a = buildArchitecture(structure, ai);
    expect(a.components.some((c) => c.name === "API")).toBe(true);
    expect(a.components.flatMap((c) => c.sources)).toHaveLength(3);
    expect(a.relationships).toHaveLength(1);
    expect(a.mode).toBe("AI-enriched");
  });
  it("rejects unvalidated, stale and broken AI while keeping the fallback", () => {
    expect(
      buildArchitecture(structure, ai, [
        { id: "arch:api", code: "architecture-evidence", severity: "error", message: "bad" },
      ]).mode,
    ).toBe("Structure-derived");
    const stale = structuredClone(ai);
    stale.components[0]!.sources[0]!.basedOnHash = "sha256:changed";
    expect(buildArchitecture(structure, stale).components.some((c) => c.id === "arch:api")).toBe(
      false,
    );
  });
  it("handles empty and large repositories with progressive disclosure", () => {
    expect(buildArchitecture({ nodes: [], edges: [], unresolvedCalls: [] }).components).toEqual([]);
    const large = buildArchitecture({
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
    const a = buildArchitecture(structure);
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
    const a = buildArchitecture(structure);
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
