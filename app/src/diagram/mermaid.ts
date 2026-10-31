import type { Diagram } from "./model";
const escape = (s: string) =>
  s
    .replace(/#/g, "#35;")
    .replace(/"/g, "#quot;")
    .replace(/</g, "#lt;")
    .replace(/>/g, "#gt;")
    .replace(/[\r\n]+/g, " ");
export function diagramToMermaid(a: Diagram): string {
  const lines = [
    "flowchart LR",
    `  %% ${escape(a.summary)}`,
    "  %% Dashed links are AI interpretations; reference checks do not prove semantics.",
    ...(a.notices ?? []).map((notice) => `  %% ${escape(notice)}`),
  ];
  const ids = new Map(a.components.map((c, i) => [c.id, `n${String(i)}`]));
  const add = (parent?: string, depth = 1) => {
    for (const c of a.components.filter((c) => c.parent === parent)) {
      const indent = "  ".repeat(depth),
        id = ids.get(c.id) ?? "";
      const children = a.components.some((s) => s.parent === c.id);
      lines.push(
        children
          ? `${indent}subgraph ${id}["${escape(`${c.name}${c.status === "stale" ? " (source changed)" : ""}: ${c.responsibility}`)}"]`
          : `${indent}${id}["${escape(`${c.name}${c.status === "stale" ? " (source changed)" : ""}: ${c.responsibility}`)}"]`,
      );
      if (children) {
        add(c.id, depth + 1);
        lines.push(`${indent}end`);
      }
    }
  };
  add();
  for (const r of a.relationships) {
    const from = ids.get(r.from),
      to = ids.get(r.to);
    if (from && to)
      lines.push(
        `  ${from} ${r.provenance === "ai" ? "-.->" : "-->"}|"${escape(`${r.label}${r.support === "unresolved" ? " (unresolved)" : ""}`)}"| ${to}`,
      );
  }
  return `${lines.join("\n")}\n`;
}
