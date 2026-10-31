import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { Component } from "./model";
export type ArchitectureNode = Node<
  { component: Component; children: number; dimmed: boolean; entryPoints: string[] },
  "architecture"
>;
export function ComponentNode({ data, selected }: NodeProps<ArchitectureNode>) {
  const c = data.component;
  return (
    <article
      className={`gv-architecture-card${data.children ? " gv-architecture-group" : ""}`}
      data-kind={c.kind}
      data-selected={selected}
      data-dimmed={data.dimmed}
    >
      <Handle id="in-left" type="target" position={Position.Left} />
      <Handle id="in-right" type="target" position={Position.Right} />
      <Handle id="in-top" type="target" position={Position.Top} />
      <div className="gv-architecture-kind">
        {c.kind}{" "}
        <span>
          {c.status === "stale"
            ? "Needs review"
            : c.provenance === "ai"
              ? "Agent authored"
              : "structure"}
        </span>
      </div>
      <h3 title={c.name}>{c.name}</h3>
      <p>{c.responsibility}</p>
      {data.entryPoints.length > 0 && (
        <div className="gv-architecture-entry">
          Entry ·{" "}
          {data.entryPoints.length > 2
            ? `${String(data.entryPoints.length)} entry points`
            : data.entryPoints.join(" · ")}
        </div>
      )}
      <footer>
        {data.children
          ? `${String(data.children)} components`
          : `${String(c.sources.length)} source references`}
      </footer>
      <Handle id="out-right" type="source" position={Position.Right} />
      <Handle id="out-left" type="source" position={Position.Left} />
      <Handle id="out-bottom" type="source" position={Position.Bottom} />
      {data.children > 0 && (
        <Handle
          id="out-group"
          type="source"
          position={Position.Bottom}
          style={{ top: 112, bottom: "auto", left: "55%" }}
        />
      )}
    </article>
  );
}
