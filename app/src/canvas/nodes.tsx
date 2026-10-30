import { Handle, type NodeProps, Position, useStore } from "@xyflow/react";
import { type CSSProperties, type KeyboardEvent, memo, type MouseEvent } from "react";

import { useAppStore } from "../store/useAppStore";
import { Chevron, ClassGlyph, FunctionGlyph, LanguageGlyph } from "./glyphs";
import { lodSelector } from "./lod";
import { StatusMark, StatusRing } from "./StatusMark";
import { middleTruncate } from "./text";
import type { FileNode, ModuleNode, ProjectNode, RowNode } from "./types";

const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;

/** Edge anchor; invisible. Phase 08 attaches relationship edges to these. */
function Anchors() {
  return (
    <>
      <Handle type="target" position={Position.Top} className="gv-handle" isConnectable={false} />
      <Handle
        type="source"
        position={Position.Bottom}
        className="gv-handle"
        isConnectable={false}
      />
    </>
  );
}

export const ProjectNodeView = memo(function ProjectNodeView({ data }: NodeProps<ProjectNode>) {
  const t = data.totals;
  return (
    <div className="gv-project">
      <span className="gv-project-name" title={data.name}>
        {data.name}
      </span>
      {data.commitSha && <span className="gv-chip gv-chip-code">{data.commitSha}</span>}
      {data.languages.map((l) => (
        <span key={l} className="gv-chip">
          {l}
        </span>
      ))}
      <span className="gv-project-totals">
        {plural(t.modules, "module")} · {plural(t.files, "file")} ·{" "}
        {plural(t.classes, "class", "classes")} · {plural(t.functions, "function")}
      </span>
      <Handle
        type="source"
        position={Position.Bottom}
        className="gv-handle"
        isConnectable={false}
      />
    </div>
  );
});

export const ModuleNodeView = memo(function ModuleNodeView({
  data,
  selected,
}: NodeProps<ModuleNode>) {
  const lod = useStore(lodSelector);
  const { node, stats } = data;
  const onHeaderClick = (e: MouseEvent) => {
    if (!e.shiftKey) return;
    e.stopPropagation();
    useAppStore.getState().toggleFiles(data.fileIds);
  };
  const counts = stats
    ? `${plural(stats.files, "file")} · ${plural(stats.functions, "function")}`
    : "";
  return (
    <div
      className="gv-module"
      data-selected={selected}
      data-synthetic={data.synthetic}
      data-status={data.synthetic ? undefined : node.docStatus}
      data-lod={lod}
      style={{ "--gv-module-color": data.color } as CSSProperties}
    >
      <Handle type="target" position={Position.Top} className="gv-handle" isConnectable={false} />
      <div
        className="gv-module-header"
        onClick={onHeaderClick}
        title={node.description !== undefined ? `AI-written: ${node.description}` : node.name}
      >
        <div className="gv-module-title-row">
          <span className="gv-module-name">{node.name}</span>
          {stats && stats.errors > 0 && (
            <span
              className="gv-chip gv-chip-error"
              title={`${plural(stats.errors, "validation error")} in this module`}
            >
              <span className="visually-hidden">Validation errors: </span>
              {stats.errors}
            </span>
          )}
          {stats && !data.synthetic && (
            <span className="gv-module-pct">{stats.documentedPct}%</span>
          )}
          {lod > 0 && stats && <StatusRing stats={stats} />}
        </div>
        {lod > 0 && node.description && (
          <div className="gv-module-description">{node.description}</div>
        )}
        <div className="gv-module-counts">{counts}</div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="gv-handle"
        isConnectable={false}
      />
    </div>
  );
});

export const FileNodeView = memo(function FileNodeView({
  id,
  data,
  selected,
}: NodeProps<FileNode>) {
  const lod = useStore(lodSelector);
  const { node } = data;
  const toggle = () => {
    useAppStore.getState().toggle(id);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      toggle();
    }
  };
  if (lod === 0) {
    return (
      <div className="gv-file gv-file-tile" data-selected={selected} data-status={node.docStatus} />
    );
  }
  return (
    <div
      className="gv-file"
      data-selected={selected}
      data-status={node.docStatus}
      data-expanded={data.expanded}
      onKeyDown={onKeyDown}
    >
      <Anchors />
      <div className="gv-file-header">
        <LanguageGlyph language={data.language} />
        <div className="gv-file-text">
          <span className="gv-file-name" title={node.source?.file ?? node.name}>
            {node.name}
          </span>
          {lod === 2 && data.directory && (
            <span className="gv-file-dir" title={data.directory}>
              {middleTruncate(data.directory, 30)}
            </span>
          )}
        </div>
        {lod === 2 && data.childCount > 0 && (
          <span className="gv-chip gv-chip-count">{data.childCount}</span>
        )}
        {data.childCount > 0 && (
          <button
            type="button"
            className="gv-file-toggle nodrag"
            aria-label={data.expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
            aria-expanded={data.expanded}
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
          >
            <Chevron expanded={data.expanded} />
          </button>
        )}
        <StatusMark node={node} />
      </div>
      {data.expanded && lod === 1 && (
        <div className="gv-file-stub">{plural(data.childCount, "item")}</div>
      )}
    </div>
  );
});

export const RowNodeView = memo(function RowNodeView({ data, selected }: NodeProps<RowNode>) {
  const lod = useStore(lodSelector);
  if (lod < 2) return null;
  const { node } = data;
  const isClass = node.kind === "class";
  return (
    <div
      className="gv-row"
      data-kind={node.kind}
      data-method={data.method}
      data-selected={selected}
      data-status={node.docStatus}
    >
      <Anchors />
      {isClass ? <ClassGlyph /> : <FunctionGlyph method={data.method} />}
      <span className="gv-row-name" title={node.name}>
        {node.name}
      </span>
      <span className="gv-row-count">
        {isClass ? plural(data.count, "method") : `${String(data.count)} ln`}
      </span>
      <StatusMark node={node} />
    </div>
  );
});
