import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { Component } from "./model";
export type ArchitectureNode = Node<
  { component: Component; children: number; dimmed: boolean },
  "architecture"
>;
export function ComponentNode({ data, selected }: NodeProps<ArchitectureNode>) {
  const c = data.component;
  return (
    <article
      className="gv-architecture-card"
      data-kind={c.kind}
      data-selected={selected}
      data-dimmed={data.dimmed}
    >
      <Handle type="target" position={Position.Left} />
      <div className="gv-architecture-kind">
        {c.kind} <span>{c.provenance === "ai" ? "AI · current" : "structure"}</span>
      </div>
      <h3 title={c.name}>{c.name}</h3>
      <p>{c.responsibility}</p>
      <footer>
        {data.children
          ? `${String(data.children)} components · open to explore`
          : `${String(c.sources.length)} source references`}
      </footer>
      <Handle type="source" position={Position.Right} />
    </article>
  );
}
