/** Architecture is a projection of indexed facts, separate from the source/call graph. */
import type {
  Architecture,
  ArchitectureComponent,
  ArchitectureRelationship,
  Evidence,
  Issue,
  Structure,
} from "../generated/contract";
export interface Component extends ArchitectureComponent {
  status: "current" | "structure-derived";
}
export interface Relationship extends ArchitectureRelationship {
  count: number;
}
export interface Diagram {
  version: 1;
  summary: string;
  mode: "Structure-derived" | "AI-enriched";
  components: Component[];
  relationships: Relationship[];
}
const sort = <T extends { id: string }>(items: T[]): T[] =>
  items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const dir = (file: string) => (file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : ".");
const evidenceKey = (e: Evidence) => `${e.file}:${String(e.line)}`;

export function buildArchitecture(
  structure: Structure,
  ai?: Architecture | null,
  issues: Issue[] = [],
): Diagram {
  const nodes = new Map(structure.nodes.map((n) => [n.id, n]));
  const files = sort(structure.nodes.filter((n) => n.type === "file" && n.source));
  const components: Component[] = [];
  const ownership = new Map<string, string>();
  const blocked = new Set(
    issues.filter((i) => i.code.startsWith("architecture-")).map((i) => i.id),
  );
  const aiIds = new Set(ai?.components.map((c) => c.id));
  const accepted: Component[] = [];
  if (ai?.version === 1 && !blocked.has("architecture")) {
    const ids = new Set<string>();
    for (const c of sort([...ai.components])) {
      const ancestry = new Set([c.id]);
      let parent = c.parent;
      let cycle = false;
      while (parent) {
        if (ancestry.has(parent) || !aiIds.has(parent)) {
          cycle = true;
          break;
        }
        ancestry.add(parent);
        parent = ai.components.find((c) => c.id === parent)?.parent;
      }
      if (
        cycle ||
        ids.has(c.id) ||
        blocked.has(c.id) ||
        !/^arch:[a-z0-9-]+$/.test(c.id) ||
        c.provenance !== "ai" ||
        !c.name.trim() ||
        !c.kind.trim() ||
        !c.responsibility.trim() ||
        !c.sources.length ||
        !c.evidence.length
      )
        continue;
      if (
        !c.sources.every(
          (s) => nodes.get(s.node)?.contentHash === s.basedOnHash && nodes.get(s.node)?.source,
        )
      )
        continue;
      if (
        !c.evidence.every((e) =>
          c.sources.some((s) => {
            const range = nodes.get(s.node)?.source;
            return range?.file === e.file && e.line >= range.startLine && e.line <= range.endLine;
          }),
        )
      )
        continue;
      const sourceFiles = new Set(c.sources.map((s) => nodes.get(s.node)?.source?.file));
      if ([...sourceFiles].some((f) => f && ownership.has(f))) continue;
      ids.add(c.id);
      for (const f of sourceFiles) if (f) ownership.set(f, c.id);
      accepted.push({ ...c, status: "current" });
    }
    // A rejected parent must also remove its descendants, rather than orphaning them.
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = accepted.length - 1; i >= 0; i--) {
        const c = accepted[i];
        if (!c) continue;
        if (c.parent && !accepted.some((p) => p.id === c.parent)) {
          accepted.splice(i, 1);
          changed = true;
          for (const [f, owner] of ownership) if (owner === c.id) ownership.delete(f);
        }
      }
    }
  }
  components.push(...accepted);
  const groups = new Map<string, Component>();
  for (const f of files) {
    if (!f.source) continue;
    const file = f.source.file;
    if (ownership.has(file)) continue;
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
  const acceptedIds = new Set(accepted.map((c) => c.id));
  if (ai)
    for (const r of ai.relationships) {
      if (
        blocked.has(r.id) ||
        !acceptedIds.has(r.from) ||
        !acceptedIds.has(r.to) ||
        r.from === r.to ||
        !r.evidence.length ||
        r.provenance !== "ai"
      )
        continue;
      relationships.set(r.id, { ...r, evidence: [...r.evidence], count: 1 });
    }
  for (const r of relationships.values()) {
    r.evidence.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
    if (r.count > 1) r.label += ` · ${String(r.count)} references`;
  }
  return {
    version: 1,
    summary:
      accepted.length && accepted.length === ai?.components.length
        ? ai.summary
        : `${String(files.length)} indexed source files, grouped by directory. Arrows show verified code dependencies.`,
    mode: accepted.length ? "AI-enriched" : "Structure-derived",
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
