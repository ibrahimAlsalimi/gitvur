import {
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  type InternalNode,
  Position,
  useInternalNode,
} from "@xyflow/react";
import { memo, useState } from "react";

import { countLabel } from "../../model/aggregateEdges";
import { useAppStore } from "../../store/useAppStore";
import { type Rect, facingAnchors } from "./geometry";
import type { RelationEdgeType } from "./types";

function rectOf(node: InternalNode | undefined): Rect | null {
  if (!node) return null;
  const { x, y } = node.internals.positionAbsolute;
  const width = node.measured.width ?? node.width ?? 0;
  const height = node.measured.height ?? node.height ?? 0;
  return { x, y, width, height };
}

/** Vertical distance between badges of parallel lines. */
const BADGE_STEP = 22;

const shortName = (id: string) => id.slice(id.lastIndexOf(":") + 1);

/**
 * A relationship line: bezier between facing sides, styled by provenance (stroke, width,
 * dash, marker). AI lines carry an "AI" pill; aggregated lines a count badge listing the
 * underlying pairs. The edge type appears beside the line on hover. Click opens evidence.
 */
export const RelationEdge = memo(function RelationEdge({
  source,
  target,
  data,
}: EdgeProps<RelationEdgeType>) {
  const [hovered, setHovered] = useState(false);
  const a = rectOf(useInternalNode(source));
  const b = rectOf(useInternalNode(target));
  if (!a || !b || !data) return null;
  const [s, t] = facingAnchors(a, b, data.offsetIndex, data.offsetCount);
  const [path, labelX, labelY] = getBezierPath({
    sourceX: s.x,
    sourceY: s.y,
    sourcePosition: s.position,
    targetX: t.x,
    targetY: t.y,
    targetPosition: t.position,
  });
  const candidate = data.kind === "candidate";
  const marker = candidate ? undefined : `url(#gv-arrow-${data.change ?? data.provenance})`;
  const count = data.pairs.length;
  const showBadge = !candidate && (data.aggregated || count > 1);
  const openEvidence = (edge = data.pairs[0]) => {
    if (edge) useAppStore.getState().showEvidence(edge);
  };
  // Parallel lines meet near their midpoints, so their badges are stacked apart.
  const badgeY = labelY + (data.offsetIndex - (data.offsetCount - 1) / 2) * BADGE_STEP;
  // The type label sits beside the line, never on it: offset away from the curve.
  const horizontal = s.position === Position.Left || s.position === Position.Right;
  const typeX = labelX + (horizontal ? 0 : 14);
  const typeY = labelY + (horizontal ? -14 : 0);

  return (
    <>
      <g
        className="gv-edge"
        data-prov={candidate ? "candidate" : data.provenance}
        data-change={data.change}
        data-hop={data.hop}
        data-preview={data.preview}
        data-hovered={hovered}
      >
        <path className="gv-edge-line" d={path} markerEnd={marker} />
        <path
          className="gv-edge-hit"
          d={path}
          onMouseEnter={() => {
            setHovered(true);
          }}
          onMouseLeave={() => {
            setHovered(false);
          }}
          onClick={(e) => {
            e.stopPropagation();
            openEvidence();
          }}
        >
          <title>
            {candidate
              ? `Possible target of ${data.label ?? "call"}`
              : `${data.type} · ${data.provenance} · ${shortName(source)} → ${shortName(target)}`}
          </title>
        </path>
      </g>
      <EdgeLabelRenderer>
        {(data.provenance === "ai" && !candidate) || showBadge ? (
          <div
            className="gv-edge-badge nodrag nopan"
            data-prov={data.provenance}
            data-hop={data.hop}
            data-preview={data.preview}
            style={{
              transform: `translate(-50%, -50%) translate(${String(labelX)}px, ${String(badgeY)}px)`,
            }}
          >
            {data.provenance === "ai" && <span className="gv-ai-pill">AI</span>}
            {showBadge && (
              <span
                className="gv-count"
                tabIndex={0}
                aria-label={`${countLabel(count, data.type)}: show pairs`}
              >
                {countLabel(count, data.type)}
                <span className="gv-count-pairs" role="tooltip">
                  {data.pairs.map((p) => (
                    <button
                      key={`${p.from}>${p.to}@${String(p.evidence.line)}`}
                      type="button"
                      className="gv-count-pair"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEvidence(p);
                      }}
                    >
                      {shortName(p.from)} → {shortName(p.to)}
                      <span className="gv-count-line">:{p.evidence.line}</span>
                    </button>
                  ))}
                </span>
              </span>
            )}
          </div>
        ) : null}
        {hovered && (
          <div
            className="gv-edge-type"
            style={{
              transform: `translate(-50%, -50%) translate(${String(typeX)}px, ${String(typeY)}px)`,
            }}
          >
            {candidate ? `possible ${data.label ?? ""}` : data.type.replace("_", " ")}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
});
