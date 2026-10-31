import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Position,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
export type ArchitectureEdge = Edge<
  { offset: number; routeX?: number },
  "architectureRelationship"
>;
/** Separate parallel facts so imports, calls and authored labels never overprint each other. */
export function RelationshipEdge({
  sourceX,
  sourceY,
  sourcePosition,
  targetPosition,
  targetX,
  targetY,
  data,
  label,
  markerEnd,
  style,
  selected,
}: EdgeProps<ArchitectureEdge>) {
  const offset = data?.offset ?? 0;
  const bend = Math.max(60, Math.abs(targetX - sourceX) / 3);
  const horizontal = sourcePosition === Position.Right && targetPosition === Position.Left;
  const [bezier, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const path =
    data?.routeX !== undefined
      ? `M ${String(sourceX)} ${String(sourceY)} H ${String(data.routeX)} V ${String(targetY - 32)} H ${String(targetX)} V ${String(targetY)}`
      : horizontal
        ? `M ${String(sourceX)} ${String(sourceY)} C ${String(sourceX + bend)} ${String(sourceY + offset)}, ${String(targetX - bend)} ${String(targetY + offset)}, ${String(targetX)} ${String(targetY)}`
        : bezier;
  return (
    <>
      <BaseEdge
        path={path}
        {...(markerEnd ? { markerEnd } : {})}
        {...(style ? { style } : {})}
        interactionWidth={24}
      />
      <EdgeLabelRenderer>
        <div
          className="gv-architecture-edge-label"
          data-selected={selected}
          style={{
            transform: `translate(-50%, -50%) translate(${String(data?.routeX !== undefined ? (data.routeX + targetX) / 2 : horizontal ? (sourceX + targetX) / 2 : labelX)}px, ${String(data?.routeX !== undefined ? targetY - 32 : horizontal ? (sourceY + targetY) / 2 + offset * 0.75 : labelY)}px)`,
          }}
        >
          {label}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
