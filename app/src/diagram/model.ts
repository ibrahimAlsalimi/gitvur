/** Saved agent architecture and explicit secondary raw-structure exploration. */
import type {
  ArchitectureComponent,
  ArchitectureRelationship,
  Evidence,
  Structure,
} from "../generated/contract";
export interface Component extends ArchitectureComponent {
  status: "current" | "stale" | "structure-derived";
}
export interface Relationship extends ArchitectureRelationship {
  count: number;
  support?: "unresolved" | "traceable";
}
export interface Diagram {
  version: 1;
  summary: string;
  mode: "Structure-derived" | "Architecture map" | "Legacy architecture";
  components: Component[];
  relationships: Relationship[];
  notices?: string[];
}
const sort = <T extends { id: string }>(items: T[]): T[] =>
  items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const dir = (file: string) => (file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : ".");
const evidenceKey = (e: Evidence) => `${e.file}:${String(e.line)}`;

export function buildStructureDiagram(structure: Structure): Diagram {
  const nodes = new Map(structure.nodes.map((n) => [n.id, n]));
  const files = sort(structure.nodes.filter((n) => n.type === "file" && n.source));
  const components: Component[] = [];
  const ownership = new Map<string, string>();
  const groups = new Map<string, Component>();
  for (const f of files) {
    if (!f.source) continue;
    const file = f.source.file;
    const directory = dir(file);
    const id = `arch:dir:${directory}`;
    let c = groups.get(id);
    if (!c) {
      c = {
        id,
        name: directory === "." ? "Repository root" : directory,
        kind: "directory",
        responsibility: `Indexed source files in ${directory === "." ? "the repository root" : directory}.`,
        sources: [],
        provenance: "syntactic",
        evidence: [],
        status: "structure-derived",
      };
      groups.set(id, c);
    }
    c.sources.push({ node: f.id, basedOnHash: f.contentHash ?? "" });
    c.evidence.push({ file, line: f.source.startLine });
    ownership.set(file, id);
  }
  components.push(...groups.values());
  // Large trees expose folder hierarchy. Nothing is dropped or capped.
  if (components.filter((c) => !c.parent).length > 15) {
    for (const c of [...groups.values()]) {
      let current = c;
      let path = c.name;
      while (path.includes("/")) {
        path = dir(path);
        const id = `arch:dir:${path}`;
        current.parent = id;
        let p = groups.get(id);
        if (!p) {
          p = {
            id,
            name: path,
            kind: "subsystem",
            responsibility: `Source directories under ${path}.`,
            sources: [],
            provenance: "syntactic",
            evidence: [],
            status: "structure-derived",
          };
          groups.set(id, p);
          components.push(p);
        }
        current = p;
      }
    }
  }
  const relationships = new Map<string, Relationship>();
  for (const edge of structure.edges) {
    if (edge.provenance !== "syntactic" || !["imports", "calls"].includes(edge.type)) continue;
    const from = ownership.get(nodes.get(edge.from)?.source?.file ?? "");
    const to = ownership.get(nodes.get(edge.to)?.source?.file ?? "");
    if (!from || !to || from === to) continue;
    const id = JSON.stringify([from, to, edge.type]);
    let r = relationships.get(id);
    if (!r) {
      r = {
        id,
        from,
        to,
        kind: edge.type,
        label: edge.type === "imports" ? "Imports" : "Calls into",
        provenance: "syntactic",
        evidence: [],
        count: 0,
      };
      relationships.set(id, r);
    }
    if (!r.evidence.some((e) => evidenceKey(e) === evidenceKey(edge.evidence)))
      r.evidence.push(edge.evidence);
    r.count += 1;
  }
  for (const r of relationships.values()) {
    r.evidence.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
    if (r.count > 1) r.label += ` · ${String(r.count)} references`;
  }
  return {
    version: 1,
    summary: `${String(files.length)} indexed source files, grouped by directory. This is raw dependency exploration, not an authored architecture map.`,
    mode: "Structure-derived",
    components: sort(components),
    relationships: sort([...relationships.values()]),
  };
}

/** Show immediate children; roll up deep edges to their visible ancestor. */
export function projectArchitecture(a: Diagram, focus: string | null, query = ""): Diagram {
  const byId = new Map(a.components.map((c) => [c.id, c]));
  const visible = a.components.filter(
    (c) =>
      (c.parent ?? null) === focus &&
      (!query ||
        `${c.name} ${c.kind} ${c.responsibility}`.toLowerCase().includes(query.toLowerCase())),
  );
  const ids = new Set(visible.map((c) => c.id));
  const ancestor = (id: string): string | undefined => {
    const seen = new Set<string>();
    while (!ids.has(id)) {
      if (seen.has(id)) return;
      seen.add(id);
      const p = byId.get(id)?.parent;
      if (!p) return;
      id = p;
    }
    return id;
  };
  const edges = new Map<string, Relationship>();
  for (const r of a.relationships) {
    const from = ancestor(r.from),
      to = ancestor(r.to);
    if (!from || !to || from === to) continue;
    const id = JSON.stringify([
      from,
      to,
      r.kind,
      r.provenance,
      r.provenance === "ai" ? r.label : "",
    ]);
    const old = edges.get(id);
    if (old) {
      old.count += r.count;
      old.evidence.push(...r.evidence);
    } else edges.set(id, { ...r, id, from, to, evidence: [...r.evidence] });
  }
  for (const r of edges.values()) {
    r.evidence = [...new Map(r.evidence.map((e) => [evidenceKey(e), e])).values()];
    if (r.provenance === "syntactic") {
      r.label = r.kind === "imports" ? "Imports" : "Calls into";
      if (r.count > 1) r.label += ` · ${String(r.count)} references`;
    }
  }
  return { ...a, components: visible, relationships: sort([...edges.values()]) };
}

/** The explanatory view contains only authored components and interactions. Never fill gaps
 * with directory nodes or import edges. Fresh backend checks are required, including for legacy
 * annotation data. A malformed standalone artifact blocks legacy fallback. */
export function savedArchitecture(
  bundle: import("../generated/contract").RepoBundle,
): Diagram | null {
  const issues = bundle.architectureIssues;
  if (!issues || issues.some((i) => i.severity === "error")) return null;
  const model = bundle.architecture?.architecture ?? bundle.annotations?.architecture;
  if (!model || model.version !== 1) return null;
  return {
    version: 1,
    summary: model.summary,
    mode: bundle.architecture ? "Architecture map" : "Legacy architecture",
    notices: [...new Set(issues.map((issue) => issue.message))],
    components: sort(
      model.components.map((c) => ({
        ...c,
        status: issues.some((i) => i.id === c.id && i.code === "architecture-stale")
          ? "stale"
          : "current",
      })),
    ),
    relationships: sort(
      model.relationships.map((r) => ({
        ...r,
        count: 1,
        support: issues.some((i) => i.id === r.id && i.code === "architecture-unresolved")
          ? "unresolved"
          : "traceable",
      })),
    ),
  };
}

/** Search keeps subsystem ancestors so nested results retain their context. */
export function filterArchitecture(a: Diagram, query: string): Diagram {
  if (!query.trim()) return a;
  const matches = new Set(
    a.components
      .filter((c) =>
        `${c.name} ${c.kind} ${c.responsibility}`.toLowerCase().includes(query.toLowerCase()),
      )
      .map((c) => c.id),
  );
  // Include children of matching groups and ancestors of matching leaves.
  for (const c of a.components) {
    let parent = c.parent;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      if (matches.has(parent)) matches.add(c.id);
      parent = a.components.find((p) => p.id === parent)?.parent;
    }
  }
  for (const id of [...matches]) {
    let parent = a.components.find((c) => c.id === id)?.parent;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      matches.add(parent);
      parent = a.components.find((c) => c.id === parent)?.parent;
    }
  }
  return {
    ...a,
    components: a.components.filter((c) => matches.has(c.id)),
    relationships: a.relationships.filter((r) => matches.has(r.from) && matches.has(r.to)),
  };
}

/** Groups expose their descendants' implementation without requiring invented source owners. */
export function componentSources(a: Diagram, id: string): Component["sources"] {
  const seen = new Set<string>();
  const sources = new Map<string, Component["sources"][number]>();
  const visit = (current: string) => {
    if (seen.has(current)) return;
    seen.add(current);
    for (const source of a.components.find((c) => c.id === current)?.sources ?? [])
      sources.set(source.node, source);
    for (const child of a.components.filter((c) => c.parent === current)) visit(child.id);
  };
  visit(id);
  return [...sources.values()];
}

/** A source reference owns its exact node and contained indexed ranges, not every unrelated
 * function in the same file. This also handles class-method ownership without inventing IDs. */
export function referencesNode(
  structure: Structure,
  sources: Component["sources"],
  id: string | null | undefined,
): boolean {
  if (!id) return false;
  const target = structure.nodes.find((n) => n.id === id)?.source;
  return sources.some((s) => {
    if (s.node === id) return true;
    const range = structure.nodes.find((n) => n.id === s.node)?.source;
    return (
      !!range &&
      !!target &&
      range.file === target.file &&
      range.startLine <= target.startLine &&
      range.endLine >= target.endLine
    );
  });
}
